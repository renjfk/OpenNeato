// Generates an OpenAPI 3.0 spec and a human-readable Markdown reference for
// the HTTP API exposed by the firmware.
//
// Sources:
//   - firmware/src/web_server.cpp  (route registrations + // @doc directives)
//   - frontend/src/types.ts        (response/body schemas via TSDoc)
//
// Outputs:
//   - frontend/dist-docs/openapi.json
//   - frontend/dist-docs/api-reference.md
//
// Usage: node frontend/scripts/gen_api_docs.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const cppPath = path.join(repoRoot, "firmware", "src", "web_server.cpp");
const tsPath = path.join(repoRoot, "frontend", "src", "types.ts");
const outDir = path.join(__dirname, "..", "dist-docs");

const VERSION = process.env.OPENNEATO_VERSION || readFirmwareVersion();

// Maps the manager method referenced in registerGetRoute(...) to the response
// schema name in types.ts. Static_cast<...> wrappers are stripped before
// lookup.
const GET_RESPONSE_TYPES = {
    "&NeatoSerial::getVersion": "VersionData",
    "&NeatoSerial::getCharger": "ChargerData",
    "&NeatoSerial::getMotors": "MotorData",
    "&NeatoSerial::getState": "StateData",
    "&NeatoSerial::getErr": "ErrorData",
    "&NeatoSerial::getLdsScan": "LidarScan",
    "&NeatoSerial::getUserSettings": "UserSettingsData",
};

const TAG_DEFAULTS = {
    Sensors: "Read-only telemetry from the robot",
    Actions: "Control commands sent to the robot",
    Manual: "Manual cleaning mode (joystick, motors)",
    Logs: "Diagnostic log files stored in flash",
    System: "ESP32 system health and lifecycle",
    Settings: "User-configurable bridge settings",
    Firmware: "ESP32 firmware version and OTA update",
    History: "Cleaning session history and map data",
};

// -- C++ route extraction ----------------------------------------------------

function parseCpp() {
    const src = fs.readFileSync(cppPath, "utf8");
    const lines = src.split("\n");

    const routes = [];
    let pendingDoc = null;
    let currentTag = null;

    const blankEntry = () => ({
        summary: null,
        manualPath: null,
        manualMethod: null,
        queries: [],
        pathParams: [],
        body: null,
        responses: [],
        errors: [],
        tag: null,
    });

    const startDoc = () => {
        if (!pendingDoc) {
            pendingDoc = {
                skip: false,
                tag: null,
                entries: [],
                _currentEntry: null,
            };
        }
        if (!pendingDoc._currentEntry) {
            pendingDoc._currentEntry = blankEntry();
            pendingDoc.entries.push(pendingDoc._currentEntry);
        }
    };

    const handleDocLine = (raw) => {
        const tagMatch = raw.match(/^\s*\/\/\s*@tag\s+([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/);
        if (tagMatch) {
            const [, name, desc] = tagMatch;
            currentTag = name;
            TAG_DEFAULTS[name] = desc;
            return;
        }

        const docMatch = raw.match(/^\s*\/\/\s*@doc\s+(.*)$/);
        if (!docMatch) return;
        const rest = docMatch[1].trim();

        if (rest === "skip") {
            startDoc();
            pendingDoc.skip = true;
            return;
        }

        const colon = rest.indexOf(":");
        if (colon < 0) {
            warn(`Malformed @doc directive: ${raw.trim()}`);
            return;
        }
        const key = rest.slice(0, colon).trim().toLowerCase();
        const value = rest.slice(colon + 1).trim();

        startDoc();

        // "path:" starts a new entry within the same comment block (e.g. when a
        // single server.on() handler covers /api/logs and /api/logs/{filename}).
        if (key === "path" && pendingDoc._currentEntry.manualPath) {
            pendingDoc._currentEntry = blankEntry();
            pendingDoc.entries.push(pendingDoc._currentEntry);
        }

        const entry = pendingDoc._currentEntry;
        switch (key) {
            case "path":
                entry.manualPath = value;
                break;
            case "method":
                entry.manualMethod = value.toUpperCase();
                break;
            case "tag":
                entry.tag = value;
                break;
            case "summary":
                entry.summary = value;
                break;
            case "query":
                entry.queries.push(parseParamSpec(value));
                break;
            case "param":
                entry.pathParams.push(parseParamSpec(value));
                break;
            case "body":
                entry.body = parseBodySpec(value);
                break;
            case "response":
                entry.responses.push(parseResponseSpec(value));
                break;
            case "errors":
                entry.errors.push(...parseErrorsSpec(value));
                break;
            default:
                warn(`Unknown @doc key: ${key}`);
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/^\s*\/\/\s*@(doc|tag)\b/.test(line)) {
            handleDocLine(line);
            continue;
        }

        if (!pendingDoc) continue;

        if (pendingDoc.skip) {
            // Consume the next registration call and forget the pending doc.
            if (looksLikeRegistration(line)) pendingDoc = null;
            continue;
        }

        const consumed = tryConsumeRegistration(lines, i, pendingDoc, currentTag, routes);
        if (consumed > 0) {
            i += consumed - 1;
            pendingDoc = null;
        }
    }

    return routes;
}

function looksLikeRegistration(line) {
    return /\b(registerGetRoute|registerPostRoute|loggedRoute|loggedBodyRoute|server\.on)\s*\(/.test(line);
}

// Reads a possibly multi-line registration call starting at lines[i] and, if
// found, appends one or more route records to `routes`. Returns the number of
// source lines consumed (0 if no registration was found on this line).
function tryConsumeRegistration(lines, i, pendingDoc, currentTag, routes) {
    if (!looksLikeRegistration(lines[i])) return 0;

    let depth = 0;
    let buf = "";
    let consumed = 0;
    let started = false;
    for (let j = i; j < lines.length && j < i + 30; j++) {
        const line = lines[j];
        for (let k = 0; k < line.length; k++) {
            const c = line[k];
            if (c === "(") {
                depth++;
                started = true;
            } else if (c === ")") {
                depth--;
            }
            buf += c;
            if (started && depth === 0) {
                consumed = j - i + 1;
                break;
            }
        }
        buf += "\n";
        if (started && depth === 0) break;
        consumed = j - i + 1;
    }

    const helper = buf.match(/(registerGetRoute|registerPostRoute|loggedRoute|loggedBodyRoute|server\.on)\s*\(/);
    if (!helper) return 0;
    const helperName = helper[1];

    const pathMatch = buf.match(/"([^"]+)"/);
    const sniffedPath = pathMatch ? pathMatch[1] : null;

    const methodMatch = buf.match(/HTTP_(GET|POST|PUT|DELETE|PATCH)/);
    const sniffedMethod = methodMatch ? methodMatch[1] : null;

    let methodPtr = null;
    if (helperName === "registerGetRoute" || helperName === "registerPostRoute") {
        const cast = buf.match(/static_cast<[^>]+>\s*\(\s*(&[A-Za-z_][\w:]*::[A-Za-z_]\w*)\s*\)/);
        const direct = buf.match(/,\s*(&[A-Za-z_][\w:]*::[A-Za-z_]\w*)\s*,/);
        methodPtr = cast ? cast[1] : direct ? direct[1] : null;
    }

    const helperMethod = {
        registerGetRoute: "GET",
        registerPostRoute: "POST",
    }[helperName];

    const entries = pendingDoc.entries.filter(hasContent);
    if (entries.length === 0) entries.push({ ...pendingDoc.entries[0] });

    for (const entry of entries) {
        const route = {
            path: entry.manualPath || sniffedPath,
            method: entry.manualMethod || helperMethod || sniffedMethod,
            tag: entry.tag || pendingDoc.tag || currentTag,
            summary: entry.summary,
            queries: entry.queries,
            pathParams: entry.pathParams,
            body: entry.body,
            responses: entry.responses,
            errors: entry.errors,
        };

        if (!route.path || !route.method) {
            warn(`Registration without path/method (helper=${helperName}, line ${i + 1})`);
            continue;
        }

        // Defaults for template helpers when @doc didn't override.
        if (helperName === "registerGetRoute") {
            if (route.responses.length === 0) {
                const typeName = methodPtr && GET_RESPONSE_TYPES[methodPtr];
                if (typeName) route.responses = [{ kind: "ref", value: typeName }];
            }
            if (route.errors.length === 0) {
                route.errors = [{ code: 504, description: "robot timeout" }];
            }
        } else if (helperName === "registerPostRoute") {
            if (route.responses.length === 0) {
                route.responses = [{ kind: "ok" }];
            }
            if (route.errors.length === 0) {
                route.errors = [
                    { code: 503, description: "robot busy" },
                    { code: 504, description: "robot timeout" },
                ];
            }
        }

        routes.push(route);
    }

    return consumed;
}

function hasContent(entry) {
    return (
        entry.manualPath ||
        entry.summary ||
        entry.queries.length ||
        entry.pathParams.length ||
        entry.body ||
        entry.responses.length ||
        entry.errors.length
    );
}

// "name type [enum=a,b,c | int range | bool 0..1] [required] [(notes)]"
function parseParamSpec(value) {
    const tokens = tokenize(value.trim());
    const out = {
        name: tokens.shift(),
        type: "string",
        required: false,
        enum: null,
        notes: null,
    };
    while (tokens.length) {
        const tok = tokens.shift();
        if (tok === "required") out.required = true;
        else if (tok === "boolean") out.type = "boolean";
        else if (tok === "integer") out.type = "integer";
        else if (tok === "number") out.type = "number";
        else if (tok === "string") out.type = "string";
        else if (tok.startsWith("enum=")) {
            out.type = "string";
            out.enum = tok.slice(5).split(",");
        } else if (/^-?\d+\.\.-?\d+$/.test(tok)) {
            const [min, max] = tok.split("..").map(Number);
            out.minimum = min;
            out.maximum = max;
        } else if (tok.startsWith("(") && tok.endsWith(")")) {
            out.notes = tok.slice(1, -1);
        }
    }
    return out;
}

// Splits on whitespace but keeps "(...)" groups intact.
function tokenize(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (i >= s.length) break;
        if (s[i] === "(") {
            const end = s.indexOf(")", i);
            if (end < 0) {
                out.push(s.slice(i));
                break;
            }
            out.push(s.slice(i, end + 1));
            i = end + 1;
        } else {
            let j = i;
            while (j < s.length && !/\s/.test(s[j])) j++;
            out.push(s.slice(i, j));
            i = j;
        }
    }
    return out;
}

function parseBodySpec(value) {
    const trimmed = value.trim();
    if (/^multipart\/form-data/i.test(trimmed)) {
        return { kind: "multipart", description: trimmed };
    }
    const refMatch = trimmed.match(/^([A-Z][A-Za-z0-9_]*)\s*(?:\(partial\))?$/);
    if (refMatch) {
        return { kind: "ref", ref: refMatch[1], partial: /\(partial\)/.test(trimmed) };
    }
    return { kind: "raw", description: trimmed };
}

function parseResponseSpec(value) {
    const trimmed = value.trim();
    if (trimmed === "Ok") return { kind: "ok" };
    const arrMatch = trimmed.match(/^array of ([A-Z][A-Za-z0-9_]*)$/);
    if (arrMatch) return { kind: "array", ref: arrMatch[1] };
    if (/^[A-Z][A-Za-z0-9_]*$/.test(trimmed)) return { kind: "ref", value: trimmed };
    return { kind: "raw", description: trimmed };
}

function parseErrorsSpec(value) {
    // Split on commas, but ignore commas inside parentheses so descriptions
    // like "400=update failed (bad hash, write error)" stay intact.
    const parts = [];
    let depth = 0;
    let cur = "";
    for (const ch of value) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
            parts.push(cur);
            cur = "";
        } else {
            cur += ch;
        }
    }
    if (cur) parts.push(cur);

    return parts
        .map((s) => s.trim())
        .filter(Boolean)
        .map((part) => {
            const m = part.match(/^(\d{3})\s*=\s*(.+)$/);
            if (!m) {
                warn(`Malformed error spec: ${part}`);
                return null;
            }
            return { code: Number(m[1]), description: m[2].trim() };
        })
        .filter(Boolean);
}

// -- TypeScript types extraction --------------------------------------------

function parseTypes() {
    const program = ts.createProgram([tsPath], {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        strict: true,
        noEmit: true,
    });
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(tsPath);
    if (!sourceFile) throw new Error(`Could not load ${tsPath}`);

    const interfaces = {};
    ts.forEachChild(sourceFile, (node) => {
        if (ts.isInterfaceDeclaration(node)) {
            interfaces[node.name.text] = describeInterface(node, checker);
        } else if (ts.isTypeAliasDeclaration(node)) {
            interfaces[node.name.text] = describeTypeAlias(node);
        }
    });
    return interfaces;
}

function describeInterface(node, checker) {
    const description = jsDocText(node);
    const properties = node.members
        .filter(ts.isPropertySignature)
        .map((member) => describeProperty(member, checker))
        .filter(Boolean);
    return { kind: "object", description, properties };
}

function describeTypeAlias(node) {
    return { kind: "alias", description: jsDocText(node), text: node.type.getText() };
}

function describeProperty(member, checker) {
    const name = member.name.getText();
    const optional = !!member.questionToken;
    const description = jsDocText(member);
    const schema = typeNodeToSchema(member.type, checker);
    return { name, optional, description, schema };
}

function typeNodeToSchema(typeNode, checker) {
    if (!typeNode) return { type: "string" };

    switch (typeNode.kind) {
        case ts.SyntaxKind.StringKeyword:
            return { type: "string" };
        case ts.SyntaxKind.NumberKeyword:
            return { type: "number" };
        case ts.SyntaxKind.BooleanKeyword:
            return { type: "boolean" };
        case ts.SyntaxKind.NullKeyword:
            return { type: "null" };
    }

    if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
        return { type: "string", const: typeNode.literal.text };
    }

    if (ts.isUnionTypeNode(typeNode)) {
        const parts = typeNode.types.map((t) => typeNodeToSchema(t, checker));
        const stringLiterals = parts.filter((p) => p.type === "string" && p.const !== undefined);
        const hasNull = parts.some((p) => p.type === "null");
        const nonNull = parts.filter((p) => p.type !== "null");
        if (stringLiterals.length === parts.length) {
            return { type: "string", enum: stringLiterals.map((p) => p.const) };
        }
        if (nonNull.length === 1) {
            return { ...nonNull[0], nullable: hasNull };
        }
        return { oneOf: parts };
    }

    if (ts.isArrayTypeNode(typeNode)) {
        return { type: "array", items: typeNodeToSchema(typeNode.elementType, checker) };
    }

    if (ts.isTupleTypeNode(typeNode)) {
        return {
            type: "array",
            prefixItems: typeNode.elements.map((e) => typeNodeToSchema(ts.isNamedTupleMember(e) ? e.type : e, checker)),
        };
    }

    if (ts.isTypeReferenceNode(typeNode)) {
        return { ref: typeNode.typeName.getText() };
    }

    return { type: "string" };
}

function jsDocText(node) {
    const docs = ts.getJSDocCommentsAndTags(node);
    if (!docs.length) return null;
    const parts = docs
        .map((d) => {
            if (typeof d.comment === "string") return d.comment;
            if (Array.isArray(d.comment)) return d.comment.map((c) => (typeof c === "string" ? c : c.text)).join("");
            return "";
        })
        .filter(Boolean);
    const text = parts.join(" ").trim();
    return text || null;
}

// -- OpenAPI builder ---------------------------------------------------------

function buildOpenApi(routes, types) {
    const tagsUsed = new Set();
    for (const r of routes) if (r.tag) tagsUsed.add(r.tag);

    const openapi = {
        openapi: "3.0.3",
        info: {
            title: "OpenNeato API",
            version: VERSION,
            description:
                "HTTP API exposed by the OpenNeato firmware. All endpoints are served on the local network only " +
                "(no authentication, no TLS). The diagnostic `/api/serial` passthrough is documented separately " +
                "in the [user guide](https://github.com/renjfk/OpenNeato/blob/main/docs/user-guide.md#serial-api).",
        },
        servers: [
            {
                url: "http://{host}",
                description: "OpenNeato bridge on local network",
                variables: { host: { default: "neato.local" } },
            },
        ],
        tags: [...tagsUsed].map((name) => ({ name, description: TAG_DEFAULTS[name] || "" })),
        paths: {},
        components: {
            schemas: buildSchemas(types, routes),
            responses: {
                Ok: {
                    description: "Success acknowledgement",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Ok" },
                        },
                    },
                },
            },
        },
    };

    for (const route of routes) {
        if (!openapi.paths[route.path]) openapi.paths[route.path] = {};
        const op = {};
        if (route.tag) op.tags = [route.tag];
        if (route.summary) op.summary = route.summary;
        const params = buildParameters(route);
        if (params.length) op.parameters = params;
        const body = buildRequestBody(route);
        if (body) op.requestBody = body;
        op.responses = buildResponses(route);
        openapi.paths[route.path][route.method.toLowerCase()] = op;
    }

    return openapi;
}

function buildSchemas(types, routes) {
    const referenced = collectReferenced(routes, types);
    const schemas = {
        Ok: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
        },
        Error: {
            type: "object",
            properties: { error: { type: "string" } },
            required: ["error"],
        },
    };
    for (const name of referenced) {
        const def = types[name];
        if (!def || def.kind !== "object") continue;
        schemas[name] = objectToSchema(def);
    }
    return schemas;
}

function collectReferenced(routes, types) {
    const out = new Set();
    const visit = (n) => {
        if (out.has(n)) return;
        out.add(n);
        const def = types[n];
        if (!def || def.kind !== "object") return;
        for (const prop of def.properties) walkSchema(prop.schema, visit);
    };
    for (const route of routes) {
        if (route.body?.kind === "ref") visit(route.body.ref);
        for (const r of route.responses || []) {
            if (r.kind === "ref") visit(r.value);
            if (r.kind === "array") visit(r.ref);
        }
    }
    return out;
}

function walkSchema(node, visit) {
    if (!node) return;
    if (node.ref) visit(node.ref);
    if (node.items) walkSchema(node.items, visit);
    if (node.prefixItems) for (const i of node.prefixItems) walkSchema(i, visit);
    if (node.oneOf) for (const o of node.oneOf) walkSchema(o, visit);
}

function objectToSchema(def) {
    const properties = {};
    const required = [];
    for (const prop of def.properties) {
        properties[prop.name] = propertyToSchema(prop);
        if (!prop.optional) required.push(prop.name);
    }
    const out = { type: "object", properties };
    if (def.description) out.description = def.description;
    if (required.length) out.required = required;
    return out;
}

function propertyToSchema(prop) {
    const schema = schemaShape(prop.schema);
    if (prop.description) schema.description = prop.description;
    return schema;
}

function schemaShape(node) {
    if (!node) return { type: "string" };
    if (node.ref) return { $ref: `#/components/schemas/${node.ref}` };
    if (node.oneOf) return { oneOf: node.oneOf.map(schemaShape) };
    if (node.type === "array") {
        const out = { type: "array" };
        if (node.items) out.items = schemaShape(node.items);
        // OpenAPI 3.0 doesn't support prefixItems; collapse to items of unknown
        // type for tuple-shaped schemas. (Only used for MapCoverageCell which
        // isn't part of any HTTP response in practice.)
        if (node.prefixItems) out.items = {};
        return out;
    }
    const out = { type: node.type };
    if (node.const !== undefined) out.enum = [node.const];
    if (node.enum) out.enum = node.enum;
    if (node.nullable) out.nullable = true;
    return out;
}

function buildParameters(route) {
    const params = [];
    for (const p of route.pathParams) {
        params.push({
            name: p.name,
            in: "path",
            required: true,
            description: p.notes || undefined,
            schema: paramSchema(p),
        });
    }
    for (const q of route.queries) {
        params.push({
            name: q.name,
            in: "query",
            required: !!q.required,
            description: q.notes || undefined,
            schema: paramSchema(q),
        });
    }
    return params.map(stripUndefined);
}

function paramSchema(p) {
    const out = { type: p.type };
    if (p.enum) out.enum = p.enum;
    if (p.minimum !== undefined) out.minimum = p.minimum;
    if (p.maximum !== undefined) out.maximum = p.maximum;
    return out;
}

function buildRequestBody(route) {
    if (!route.body) return null;
    if (route.body.kind === "ref") {
        return {
            required: true,
            content: {
                "application/json": {
                    schema: { $ref: `#/components/schemas/${route.body.ref}` },
                },
            },
        };
    }
    if (route.body.kind === "multipart") {
        return {
            required: true,
            content: {
                "multipart/form-data": {
                    schema: {
                        type: "object",
                        properties: { file: { type: "string", format: "binary" } },
                        required: ["file"],
                    },
                },
            },
        };
    }
    return null;
}

function buildResponses(route) {
    const out = {};
    const responses = route.responses || [];
    if (responses.length === 0) {
        out["200"] = { $ref: "#/components/responses/Ok" };
    } else {
        for (const r of responses) {
            if (r.kind === "ok") {
                out["200"] = { $ref: "#/components/responses/Ok" };
            } else if (r.kind === "ref") {
                out["200"] = jsonResponse({ $ref: `#/components/schemas/${r.value}` });
            } else if (r.kind === "array") {
                out["200"] = jsonResponse({
                    type: "array",
                    items: { $ref: `#/components/schemas/${r.ref}` },
                });
            } else if (r.kind === "raw") {
                const ct = r.description.split(/\s+/)[0];
                out["200"] = {
                    description: r.description,
                    content: { [ct]: { schema: { type: "string" } } },
                };
            }
        }
    }
    for (const e of route.errors) {
        out[String(e.code)] = {
            description: e.description,
            content: {
                "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
        };
    }
    return out;
}

function jsonResponse(schema) {
    return {
        description: "OK",
        content: { "application/json": { schema } },
    };
}

function stripUndefined(obj) {
    if (Array.isArray(obj)) return obj.map(stripUndefined);
    if (obj && typeof obj === "object") {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            if (v === undefined) continue;
            out[k] = stripUndefined(v);
        }
        return out;
    }
    return obj;
}

// -- Markdown renderer (operates on the validated OpenAPI document) ---------

function renderMarkdown(spec) {
    const lines = [];
    lines.push(`# ${spec.info.title}`);
    lines.push("");
    lines.push(`Version: \`${spec.info.version}\``);
    lines.push("");
    if (spec.info.description) lines.push(spec.info.description);
    lines.push("");
    lines.push("## Base URL");
    lines.push("");
    for (const s of spec.servers || []) {
        lines.push(`- \`${s.url}\` ${s.description ? `- ${s.description}` : ""}`);
    }
    lines.push("");

    // Group operations by tag, preserving the order tags appear in the spec.
    const byTag = new Map();
    for (const tag of spec.tags || []) byTag.set(tag.name, []);
    byTag.set("Other", []);

    for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
        for (const method of ["get", "post", "put", "delete", "patch"]) {
            const op = pathItem[method];
            if (!op) continue;
            const tag = op.tags?.[0] || "Other";
            if (!byTag.has(tag)) byTag.set(tag, []);
            byTag.get(tag).push({ method: method.toUpperCase(), path: pathKey, op });
        }
    }

    lines.push("## Endpoints");
    lines.push("");

    for (const [tagName, ops] of byTag) {
        if (ops.length === 0) continue;
        const tagDef = (spec.tags || []).find((t) => t.name === tagName);
        lines.push(`### ${tagName}`);
        if (tagDef?.description) lines.push(tagDef.description);
        lines.push("");
        for (const { method, path: routePath, op } of ops) {
            renderOperation(method, routePath, op, spec, lines);
        }
    }

    lines.push("## Schemas");
    lines.push("");
    const schemas = spec.components?.schemas || {};
    const schemaNames = Object.keys(schemas).sort();
    for (const name of schemaNames) {
        renderSchema(name, schemas[name], lines);
    }

    return lines.join("\n");
}

function renderOperation(method, routePath, op, spec, lines) {
    lines.push(`#### \`${method} ${routePath}\``);
    lines.push("");
    if (op.summary) {
        lines.push(op.summary);
        lines.push("");
    }
    if (op.parameters?.length) {
        lines.push("**Parameters**");
        lines.push("");
        lines.push("| Name | In | Type | Required | Description |");
        lines.push("|------|----|------|----------|-------------|");
        for (const p of op.parameters) {
            lines.push(
                `| \`${p.name}\` | ${p.in} | ${formatParamSchema(p.schema)} | ${p.required ? "yes" : "no"} | ${escapeMd(p.description || "")} |`,
            );
        }
        lines.push("");
    }
    if (op.requestBody) {
        lines.push("**Request body**");
        lines.push("");
        const content = op.requestBody.content || {};
        const ct = Object.keys(content)[0];
        if (ct === "application/json") {
            const ref = content[ct]?.schema?.$ref;
            if (ref) {
                const name = ref.split("/").pop();
                lines.push(`JSON object matching [\`${name}\`](#${name.toLowerCase()}).`);
            } else {
                lines.push("JSON body.");
            }
        } else if (ct === "multipart/form-data") {
            lines.push("`multipart/form-data` with a `file` field containing the upload payload.");
        } else if (ct) {
            lines.push(`Content type \`${ct}\`.`);
        }
        lines.push("");
    }
    lines.push("**Responses**");
    lines.push("");
    lines.push("| Status | Description | Body |");
    lines.push("|--------|-------------|------|");
    for (const [status, resp] of Object.entries(op.responses || {})) {
        const resolved = resolveResponse(resp, spec);
        const body = describeResponseBody(resolved);
        lines.push(`| ${status} | ${escapeMd(resolved.description || "")} | ${body} |`);
    }
    lines.push("");
}

function resolveResponse(resp, spec) {
    if (!resp.$ref) return resp;
    const name = resp.$ref.split("/").pop();
    return spec.components?.responses?.[name] || { description: "" };
}

function describeResponseBody(resp) {
    if (!resp.content) return "";
    const ct = Object.keys(resp.content)[0];
    if (!ct) return "";
    const schema = resp.content[ct]?.schema;
    if (!schema) return `\`${ct}\``;
    if (schema.$ref) {
        const name = schema.$ref.split("/").pop();
        return `[\`${name}\`](#${name.toLowerCase()})`;
    }
    if (schema.type === "array" && schema.items?.$ref) {
        const name = schema.items.$ref.split("/").pop();
        return `array of [\`${name}\`](#${name.toLowerCase()})`;
    }
    if (schema.type === "object" && schema.properties) {
        const fields = Object.keys(schema.properties)
            .map((k) => `\`${k}\``)
            .join(", ");
        return `object: ${fields}`;
    }
    return `\`${ct}\``;
}

function renderSchema(name, schema, lines) {
    lines.push(`### \`${name}\``);
    if (schema.description) {
        lines.push("");
        lines.push(schema.description);
    }
    lines.push("");
    if (schema.type === "object" && schema.properties) {
        const required = new Set(schema.required || []);
        lines.push("| Field | Type | Required | Description |");
        lines.push("|-------|------|----------|-------------|");
        for (const [field, fs] of Object.entries(schema.properties)) {
            lines.push(
                `| \`${field}\` | ${formatPropSchema(fs)} | ${required.has(field) ? "yes" : "no"} | ${escapeMd(fs.description || "")} |`,
            );
        }
    }
    lines.push("");
}

function formatParamSchema(schema) {
    if (!schema) return "string";
    if (schema.enum) return `${schema.type} (\`${schema.enum.join("\\|")}\`)`;
    let out = schema.type || "string";
    if (schema.minimum !== undefined || schema.maximum !== undefined) {
        out += ` (${schema.minimum ?? "-∞"}..${schema.maximum ?? "∞"})`;
    }
    return out;
}

function formatPropSchema(schema) {
    if (!schema) return "any";
    if (schema.$ref) {
        const n = schema.$ref.split("/").pop();
        return `[\`${n}\`](#${n.toLowerCase()})`;
    }
    if (schema.type === "array") {
        if (schema.items?.$ref) {
            const n = schema.items.$ref.split("/").pop();
            return `array of [\`${n}\`](#${n.toLowerCase()})`;
        }
        if (schema.items?.type) return `array of ${schema.items.type}`;
        return "array";
    }
    if (schema.enum) return `${schema.type} (\`${schema.enum.join("\\|")}\`)`;
    if (schema.oneOf) return schema.oneOf.map(formatPropSchema).join(" \\| ");
    let out = schema.type || "any";
    if (schema.nullable) out += " \\| null";
    return out;
}

function escapeMd(s) {
    return String(s).replace(/\|/g, "\\|");
}

// -- Helpers -----------------------------------------------------------------

function readFirmwareVersion() {
    try {
        const ini = fs.readFileSync(path.join(repoRoot, "platformio.ini"), "utf8");
        const m = ini.match(/FIRMWARE_VERSION\s*=\s*"?([^"\n\s]+)"?/);
        if (m) return m[1];
    } catch {}
    return "0.0.0-dev";
}

function warn(msg) {
    process.stderr.write(`[gen_api_docs] WARN: ${msg}\n`);
}

// -- Main --------------------------------------------------------------------

function main() {
    fs.mkdirSync(outDir, { recursive: true });

    const routes = parseCpp();
    const types = parseTypes();

    const openapi = buildOpenApi(routes, types);
    fs.writeFileSync(path.join(outDir, "openapi.json"), `${JSON.stringify(openapi, null, 2)}\n`);

    const markdown = renderMarkdown(openapi);
    fs.writeFileSync(path.join(outDir, "api-reference.md"), markdown);

    process.stdout.write(
        `[gen_api_docs] Wrote ${routes.length} routes, ${Object.keys(types).length} types -> ${path.relative(
            repoRoot,
            outDir,
        )}\n`,
    );
}

try {
    main();
} catch (err) {
    process.stderr.write(`[gen_api_docs] ${err.stack || err.message}\n`);
    process.exit(1);
}
