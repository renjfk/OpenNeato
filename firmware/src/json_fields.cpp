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
