#include "map_config_parser.h"

#include <ctype.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

namespace {
    constexpr size_t MAX_MAP_NAME = 96;
    constexpr size_t MAX_ZONE_NAME = 64;
    constexpr size_t MAX_ID = 48;
    constexpr size_t MAX_ZONES = 16;
    constexpr size_t MAX_LINES = 32;
    constexpr size_t MAX_POINTS = 64;

    class Parser {
    public:
        Parser(const String& source, String& error) : source(source), error(error), length(source.length()) {}

        bool parse() {
            bool version = false, name = false, zones = false, lines = false;
            ws();
            if (!take('{'))
                return fail("map configuration must be an object");
            ws();
            if (at('}'))
                return fail("map configuration is missing required fields");
            while (true) {
                char key[16];
                if (!string(key, sizeof(key)) || !separator(':', "expected ':' after map configuration field"))
                    return false;
                if (!strcmp(key, "version")) {
                    if (version)
                        return fail("duplicate version field");
                    version = true;
                    if (!take('1') || (position < length && isdigit(static_cast<unsigned char>(source[position]))))
                        return fail("map configuration version must be 1");
                } else if (!strcmp(key, "name")) {
                    if (name)
                        return fail("duplicate name field");
                    name = true;
                    char value[MAX_MAP_NAME + 1];
                    if (!string(value, sizeof(value)))
                        return false;
                } else if (!strcmp(key, "zones")) {
                    if (zones)
                        return fail("duplicate zones field");
                    zones = true;
                    if (!zoneArray())
                        return false;
                } else if (!strcmp(key, "noGoLines")) {
                    if (lines)
                        return fail("duplicate noGoLines field");
                    lines = true;
                    if (!lineArray())
                        return false;
                } else {
                    return fail("unknown map configuration field");
                }
                ws();
                if (take('}'))
                    break;
                if (!separator(',', "expected ',' between map configuration fields"))
                    return false;
            }
            ws();
            if (position != length)
                return fail("unexpected data after map configuration");
            return (version && name && zones && lines) ||
                   fail("map configuration requires version, name, zones, and noGoLines");
        }

    private:
        const String& source;
        String& error;
        size_t length;
        size_t position = 0;
        char ids[MAX_ZONES + MAX_LINES][MAX_ID + 1] = {};
        size_t idCount = 0;

        bool fail(const char *message) {
            if (error.isEmpty())
                error = message;
            return false;
        }
        void ws() {
            while (position < length && (source[position] == ' ' || source[position] == '\t' ||
                                         source[position] == '\r' || source[position] == '\n'))
                position++;
        }
        bool at(char c) const { return position < length && source[position] == c; }
        bool take(char c) {
            if (!at(c))
                return false;
            position++;
            return true;
        }
        bool separator(char c, const char *message) {
            ws();
            if (!take(c))
                return fail(message);
            ws();
            if (c == ',' && (at(']') || at('}')))
                return fail("trailing comma is not allowed");
            return true;
        }
        static int hex(char c) {
            if (c >= '0' && c <= '9')
                return c - '0';
            if (c >= 'a' && c <= 'f')
                return c - 'a' + 10;
            if (c >= 'A' && c <= 'F')
                return c - 'A' + 10;
            return -1;
        }
        bool codeUnit(uint16_t& value) {
            if (position + 4 > length)
                return fail("incomplete unicode escape");
            value = 0;
            for (int i = 0; i < 4; i++) {
                int digit = hex(source[position++]);
                if (digit < 0)
                    return fail("invalid unicode escape");
                value = static_cast<uint16_t>((value << 4) | digit);
            }
            return true;
        }
        bool append(char *out, size_t capacity, size_t& used, uint32_t point) {
            uint8_t bytes[4];
            size_t count;
            if (point <= 0x7f) {
                bytes[0] = point;
                count = 1;
            } else if (point <= 0x7ff) {
                bytes[0] = 0xc0 | (point >> 6);
                bytes[1] = 0x80 | (point & 0x3f);
                count = 2;
            } else if (point <= 0xffff) {
                bytes[0] = 0xe0 | (point >> 12);
                bytes[1] = 0x80 | ((point >> 6) & 0x3f);
                bytes[2] = 0x80 | (point & 0x3f);
                count = 3;
            } else {
                bytes[0] = 0xf0 | (point >> 18);
                bytes[1] = 0x80 | ((point >> 12) & 0x3f);
                bytes[2] = 0x80 | ((point >> 6) & 0x3f);
                bytes[3] = 0x80 | (point & 0x3f);
                count = 4;
            }
            if (used + count >= capacity)
                return fail("string value is too long");
            for (size_t i = 0; i < count; i++)
                out[used++] = bytes[i];
            return true;
        }
        bool string(char *out, size_t capacity) {
            if (!take('"'))
                return fail("expected JSON string");
            size_t used = 0;
            while (position < length) {
                uint8_t c = source[position++];
                if (c == '"') {
                    out[used] = '\0';
                    return true;
                }
                if (c < 0x20)
                    return fail("unescaped control character in string");
                if (c != '\\') {
                    if (used + 1 >= capacity)
                        return fail("string value is too long");
                    out[used++] = c;
                    continue;
                }
                if (position >= length)
                    return fail("incomplete string escape");
                char escape = source[position++];
                if (escape == 'u') {
                    uint16_t first;
                    if (!codeUnit(first))
                        return false;
                    uint32_t point = first;
                    if (first >= 0xd800 && first <= 0xdbff) {
                        if (position + 2 > length || source[position] != '\\' || source[position + 1] != 'u')
                            return fail("unicode high surrogate requires low surrogate");
                        position += 2;
                        uint16_t second;
                        if (!codeUnit(second) || second < 0xdc00 || second > 0xdfff)
                            return fail("invalid unicode surrogate pair");
                        point = 0x10000 + ((first - 0xd800) << 10) + second - 0xdc00;
                    } else if (first >= 0xdc00 && first <= 0xdfff) {
                        return fail("unexpected unicode low surrogate");
                    }
                    if (!append(out, capacity, used, point))
                        return false;
                    continue;
                }
                const char *escapes = "\"\\/bfnrt";
                const char decoded[] = {'"', '\\', '/', '\b', '\f', '\n', '\r', '\t'};
                const char *found = strchr(escapes, escape);
                if (!found)
                    return fail("invalid string escape");
                if (used + 1 >= capacity)
                    return fail("string value is too long");
                out[used++] = decoded[found - escapes];
            }
            return fail("unterminated JSON string");
        }
        bool number(double& result) {
            size_t start = position;
            take('-');
            if (take('0')) {
                if (position < length && isdigit(static_cast<unsigned char>(source[position])))
                    return fail("invalid number with leading zero");
            } else {
                if (position >= length || source[position] < '1' || source[position] > '9')
                    return fail("expected finite number");
                while (position < length && isdigit(static_cast<unsigned char>(source[position])))
                    position++;
            }
            if (take('.')) {
                if (position >= length || !isdigit(static_cast<unsigned char>(source[position])))
                    return fail("invalid number fraction");
                while (position < length && isdigit(static_cast<unsigned char>(source[position])))
                    position++;
            }
            if (position < length && (source[position] == 'e' || source[position] == 'E')) {
                position++;
                if (position < length && (source[position] == '+' || source[position] == '-'))
                    position++;
                if (position >= length || !isdigit(static_cast<unsigned char>(source[position])))
                    return fail("invalid number exponent");
                while (position < length && isdigit(static_cast<unsigned char>(source[position])))
                    position++;
            }
            size_t count = position - start;
            if (!count || count >= 48)
                return fail("number is too long");
            char token[48];
            for (size_t i = 0; i < count; i++)
                token[i] = source[start + i];
            token[count] = '\0';
            char *end;
            result = strtod(token, &end);
            return (*end == '\0' && isfinite(result)) || fail("coordinate must be finite");
        }
        bool point(double *x = nullptr, double *y = nullptr) {
            if (!take('{'))
                return fail("map point must be an object");
            bool gotX = false, gotY = false;
            double px = 0, py = 0;
            ws();
            while (!at('}')) {
                char key[4];
                if (!string(key, sizeof(key)) || !separator(':', "expected ':' after point field"))
                    return false;
                if (!strcmp(key, "x") && !gotX) {
                    gotX = number(px);
                    if (!gotX)
                        return false;
                } else if (!strcmp(key, "y") && !gotY) {
                    gotY = number(py);
                    if (!gotY)
                        return false;
                } else {
                    return fail("unknown or duplicate map point field");
                }
                ws();
                if (at('}'))
                    break;
                if (!separator(',', "expected ',' between point fields"))
                    return false;
            }
            if (!take('}') || !gotX || !gotY)
                return fail("map point requires x and y");
            if (x)
                *x = px;
            if (y)
                *y = py;
            return true;
        }
        bool rememberId(const char *id) {
            if (!id[0])
                return fail("map element id cannot be empty");
            for (size_t i = 0; i < idCount; i++)
                if (!strcmp(ids[i], id))
                    return fail("map element ids must be unique");
            strcpy(ids[idCount++], id);
            return true;
        }
        bool zone() {
            if (!take('{'))
                return fail("zone must be an object");
            bool gotId = false, gotName = false, gotPoints = false;
            char id[MAX_ID + 1] = {};
            ws();
            while (!at('}')) {
                char key[8];
                if (!string(key, sizeof(key)) || !separator(':', "expected ':' after zone field"))
                    return false;
                if (!strcmp(key, "id") && !gotId) {
                    gotId = string(id, sizeof(id));
                    if (!gotId)
                        return false;
                } else if (!strcmp(key, "name") && !gotName) {
                    char name[MAX_ZONE_NAME + 1];
                    gotName = string(name, sizeof(name));
                    if (!gotName)
                        return false;
                } else if (!strcmp(key, "points") && !gotPoints) {
                    gotPoints = true;
                    if (!take('['))
                        return fail("zone points must be an array");
                    ws();
                    size_t count = 0;
                    while (!at(']')) {
                        if (count++ >= MAX_POINTS || !point())
                            return count > MAX_POINTS ? fail("zone has too many points") : false;
                        ws();
                        if (at(']'))
                            break;
                        if (!separator(',', "expected ',' between zone points"))
                            return false;
                    }
                    if (!take(']') || count < 3)
                        return fail("zone requires between three and 64 points");
                } else {
                    return fail("unknown or duplicate zone field");
                }
                ws();
                if (at('}'))
                    break;
                if (!separator(',', "expected ',' between zone fields"))
                    return false;
            }
            if (!take('}') || !gotId || !gotName || !gotPoints)
                return fail("zone requires id, name, and points");
            return rememberId(id);
        }
        bool zoneArray() {
            if (!take('['))
                return fail("zones must be an array");
            ws();
            size_t count = 0;
            while (!at(']')) {
                if (count >= MAX_ZONES)
                    return fail("map configuration has too many zones");
                if (!zone())
                    return false;
                count++;
                ws();
                if (at(']'))
                    break;
                if (!separator(',', "expected ',' between zones"))
                    return false;
            }
            return take(']') || fail("unterminated zones array");
        }
        bool line() {
            if (!take('{'))
                return fail("no-go line must be an object");
            bool gotId = false, gotStart = false, gotEnd = false;
            char id[MAX_ID + 1] = {};
            double startX = 0, startY = 0, endX = 0, endY = 0;
            ws();
            while (!at('}')) {
                char key[8];
                if (!string(key, sizeof(key)) || !separator(':', "expected ':' after no-go line field"))
                    return false;
                if (!strcmp(key, "id") && !gotId) {
                    gotId = string(id, sizeof(id));
                    if (!gotId)
                        return false;
                } else if (!strcmp(key, "start") && !gotStart) {
                    gotStart = point(&startX, &startY);
                    if (!gotStart)
                        return false;
                } else if (!strcmp(key, "end") && !gotEnd) {
                    gotEnd = point(&endX, &endY);
                    if (!gotEnd)
                        return false;
                } else {
                    return fail("unknown or duplicate no-go line field");
                }
                ws();
                if (at('}'))
                    break;
                if (!separator(',', "expected ',' between no-go line fields"))
                    return false;
            }
            if (!take('}') || !gotId || !gotStart || !gotEnd)
                return fail("no-go line requires id, start, and end");
            if (startX == endX && startY == endY)
                return fail("no-go line start and end must differ");
            return rememberId(id);
        }
        bool lineArray() {
            if (!take('['))
                return fail("noGoLines must be an array");
            ws();
            size_t count = 0;
            while (!at(']')) {
                if (count >= MAX_LINES)
                    return fail("map configuration has too many no-go lines");
                if (!line())
                    return false;
                count++;
                ws();
                if (at(']'))
                    break;
                if (!separator(',', "expected ',' between no-go lines"))
                    return false;
            }
            return take(']') || fail("unterminated noGoLines array");
        }
    };
} // namespace

bool parseMapConfig(const String& json, String& error) {
    error = "";
    Parser parser(json, error);
    return parser.parse();
}
