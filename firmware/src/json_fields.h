#ifndef JSON_FIELDS_H
#define JSON_FIELDS_H

#include <Arduino.h>
#include <vector>

// Lightweight field-based JSON serialization.
// Structs that inherit from JsonSerializable get toJson() for free
// by implementing toFields().

enum FieldType { FIELD_INT, FIELD_FLOAT, FIELD_BOOL, FIELD_STRING };

struct Field {
    String key;
    String value;
    FieldType type;
};

// Escape a string for safe embedding in JSON (handles ", \, newlines, control chars).
String jsonEscape(const String& s);

// Serialize a flat list of fields to a JSON object string.
// INT, FLOAT, BOOL render as-is (42, 14.58, true/false); STRING is quoted and escaped.
String fieldsToJson(const std::vector<Field>& fields);

// Same as fieldsToJson but without the outer braces — for embedding inside a larger object.
String fieldsToJsonInner(const std::vector<Field>& fields);

// Base struct for JSON-serializable types.
// Subclasses implement toFields(); toJson() is provided automatically.
struct JsonSerializable {
    virtual ~JsonSerializable() = default;
    virtual std::vector<Field> toFields() const = 0;
    String toJson() const { return fieldsToJson(toFields()); }
};

#endif // JSON_FIELDS_H
