#include "json_fields.h"

String jsonEscape(const String& s) {
    String out;
    out.reserve(s.length() + 16);
    for (unsigned int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        switch (c) {
            case '"':
                out += "\\\"";
                break;
            case '\\':
                out += "\\\\";
                break;
            case '\n':
                out += "\\n";
                break;
            case '\r':
                out += "\\r";
                break;
            case '\t':
                out += "\\t";
                break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += c;
                }
                break;
        }
    }
    return out;
}

String fieldsToJsonInner(const std::vector<Field>& fields) {
    String json;
    for (size_t i = 0; i < fields.size(); i++) {
        if (i > 0)
            json += ",";
        json += "\"" + fields[i].key + "\":";
        if (fields[i].type == FIELD_STRING) {
            json += "\"" + jsonEscape(fields[i].value) + "\"";
        } else {
            // INT, FLOAT, BOOL all render as-is (42, 14.58, true/false)
            json += fields[i].value;
        }
    }
    return json;
}

String fieldsToJson(const std::vector<Field>& fields) {
    return "{" + fieldsToJsonInner(fields) + "}";
}

// -- JSON parsing (inverse of serialization) ---------------------------------

// Skip whitespace characters (space, tab, CR, LF)
static int skipWs(const String& s, int pos) {
    int len = static_cast<int>(s.length());
    while (pos < len) {
        char c = s.charAt(pos);
        if (c != ' ' && c != '\t' && c != '\r' && c != '\n')
            break;
        pos++;
    }
    return pos;
}

// Parse a JSON string value starting at pos (which must point to the opening quote).
// Returns the position after the closing quote, or -1 on error.
// The unescaped string content is written to `out`.
static int parseString(const String& s, int pos, String& out) {
    int len = static_cast<int>(s.length());
    if (pos >= len || s.charAt(pos) != '"')
        return -1;
    pos++; // skip opening quote

    out = "";
    while (pos < len) {
        char c = s.charAt(pos);
        if (c == '\\' && pos + 1 < len) {
            pos++;
            char esc = s.charAt(pos);
            switch (esc) {
                case '"':
                    out += '"';
                    break;
                case '\\':
                    out += '\\';
                    break;
                case 'n':
                    out += '\n';
                    break;
                case 'r':
                    out += '\r';
                    break;
                case 't':
                    out += '\t';
                    break;
                default:
                    out += esc;
                    break;
            }
            pos++;
            continue;
        }
        if (c == '"')
            return pos + 1; // past closing quote
        out += c;
        pos++;
    }
    return -1; // unterminated string
}

// Parse a JSON literal value (number, bool, null) starting at pos.
// Returns the position after the value, or -1 on error.
// The raw text is written to `out`, type is inferred.
static int parseLiteral(const String& s, int pos, String& out, FieldType& type) {
    int len = static_cast<int>(s.length());
    if (pos >= len)
        return -1;

    // Check for true/false
    if (s.substring(pos, pos + 4) == "true") {
        out = "true";
        type = FIELD_BOOL;
        return pos + 4;
    }
    if (s.substring(pos, pos + 5) == "false") {
        out = "false";
        type = FIELD_BOOL;
        return pos + 5;
    }

    // Check for null — store as empty string
    if (s.substring(pos, pos + 4) == "null") {
        out = "";
        type = FIELD_STRING;
        return pos + 4;
    }

    // Number: consume digits, dot, minus, e/E, +
    int start = pos;
    bool hasDot = false;
    while (pos < len) {
        char c = s.charAt(pos);
        if (c == '.')
            hasDot = true;
        if ((c >= '0' && c <= '9') || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E') {
            pos++;
            continue;
        }
        break;
    }
    if (pos == start)
        return -1; // not a valid literal

    out = s.substring(start, pos);
    type = hasDot ? FIELD_FLOAT : FIELD_INT;
    return pos;
}

std::vector<Field> fieldsFromJson(const String& json) {
    std::vector<Field> fields;
    int len = static_cast<int>(json.length());
    int pos = skipWs(json, 0);

    // Expect opening brace
    if (pos >= len || json.charAt(pos) != '{')
        return fields;
    pos++;

    while (true) {
        pos = skipWs(json, pos);
        if (pos >= len)
            break;

        // End of object
        if (json.charAt(pos) == '}')
            break;

        // Comma between entries
        if (json.charAt(pos) == ',') {
            pos++;
            continue;
        }

        // Parse key
        String key;
        pos = parseString(json, pos, key);
        if (pos < 0)
            return fields; // parse error

        // Expect colon
        pos = skipWs(json, pos);
        if (pos >= len || json.charAt(pos) != ':')
            return fields;
        pos++;
        pos = skipWs(json, pos);

        // Parse value
        if (pos >= len)
            return fields;

        String value;
        FieldType type;
        if (json.charAt(pos) == '"') {
            // String value
            pos = parseString(json, pos, value);
            if (pos < 0)
                return fields;
            type = FIELD_STRING;
        } else {
            // Literal value (number, bool, null)
            pos = parseLiteral(json, pos, value, type);
            if (pos < 0)
                return fields;
        }

        fields.push_back({key, value, type});
    }

    return fields;
}

const Field *findField(const std::vector<Field>& fields, const char *key) {
    for (size_t i = 0; i < fields.size(); i++) {
        if (fields[i].key == key)
            return &fields[i];
    }
    return nullptr;
}

bool JsonSerializable::fromJson(const String& json) {
    std::vector<Field> fields = fieldsFromJson(json);
    if (fields.empty())
        return false;
    return fromFields(fields);
}
