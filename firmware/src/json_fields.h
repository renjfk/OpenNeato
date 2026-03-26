#ifndef JSON_FIELDS_H
#define JSON_FIELDS_H

#include <Arduino.h>
#include <vector>

// Lightweight field-based JSON serialization and parsing.
// Structs that inherit from JsonSerializable get toJson()/fromJson() for free
// by implementing toFields() and fromFields().

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

// Parse a flat JSON object string into a list of fields (inverse of fieldsToJson).
// Values are stored as raw strings; type is inferred from JSON syntax:
//   "..." -> FIELD_STRING, true/false -> FIELD_BOOL, contains '.' -> FIELD_FLOAT, else FIELD_INT
// Returns empty vector on parse error.
std::vector<Field> fieldsFromJson(const String& json);

// Look up a field by key. Returns nullptr if not found.
const Field *findField(const std::vector<Field>& fields, const char *key);

// Quick structural validation: checks balanced braces, starts with '{', ends with '}'.
// Does NOT validate full JSON grammar — just enough to reject obviously corrupted
// strings before embedding them as raw values in a larger JSON response.
bool isValidJsonObject(const String& s);

// Base struct for JSON-serializable types.
// Subclasses implement toFields() for serialization and fromFields() for deserialization.
struct JsonSerializable {
    virtual ~JsonSerializable() = default;
    virtual std::vector<Field> toFields() const = 0;
    String toJson() const { return fieldsToJson(toFields()); }

    // Populate struct members from parsed fields. Subclasses should only update
    // members for which a matching field exists (partial update support).
    // Returns true if at least one field was applied.
    virtual bool fromFields(const std::vector<Field>& fields) { return false; }

    // Convenience: parse JSON and apply fields in one step.
    bool fromJson(const String& json);
};

#endif // JSON_FIELDS_H
