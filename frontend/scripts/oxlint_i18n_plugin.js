// OpenNeato frontend i18n rules for oxlint.
//
// This plugin enforces two project-specific invariants:
// - User-facing JSX text must be wrapped in <T>...</T>, and user-facing props or programmatic text must go through
//   t(...). This keeps source strings discoverable and avoids dynamic <T> content.
//
//   Good:
//     <T>Settings</T>
//     aria-label={t("Back")}
//     {t("Uploading... {progress}%", { progress })}
//
//   Bad:
//     Settings
//     aria-label="Back"
//     <T>{label}</T>
//     <T>{"Settings"}</T>
//     <T>Uploading... {progress}%</T>
//
// - Every locale JSON file in src/i18n/locales must have the exact same keys in the exact same order. Files are checked
//   pairwise, so no locale acts as the single reference file.
//
//   Good:
//     tr.json: { "Back": "Geri", "Settings": "Ayarlar" }
//     de.json: { "Back": "Zurück", "Settings": "Einstellungen" }
//
//   Bad:
//     tr.json: { "Back": "Geri", "Settings": "Ayarlar" }
//     de.json: { "Settings": "Einstellungen", "Back": "Zurück" }
//
// Configure rules in frontend/.oxlintrc.json. Run with npm run i18n:check or npm run check.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_RE = /[A-Za-z]/;
const ENTITY_OR_SYMBOL_RE = /^(?:\s|&[A-Za-z]+;|[.,:;()%+\-*/<>|?])+$|^[xX]$/;
const INLINE_UNIT_RE = /^[()\s,.-]*(?:%|C|V|m|mA|mAh|KB|MB|GB|RPM|dBm|mW)(?:&[A-Za-z]+;)?[()\s,.-]*$/;
const DEFAULT_ALLOWED_TEXT = ["OpenNeato"];
const DEFAULT_IGNORED_ELEMENTS = ["code", "kbd", "pre", "samp"];
const DEFAULT_TRANSLATABLE_ATTRS = [
    "aria-description",
    "aria-label",
    "aria-roledescription",
    "ariaLabel",
    "confirmLabel",
    "inputLabel",
    "inputPlaceholder",
    "label",
    "message",
    "placeholder",
    "title",
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(scriptDir, "..");
const localesDir = path.join(projectRoot, "src", "i18n", "locales");

function jsxNameName(name) {
    if (!name) return "";
    if (name.type === "JSXIdentifier") return name.name;
    if (name.type === "JSXNamespacedName") return `${jsxNameName(name.namespace)}:${jsxNameName(name.name)}`;
    if (name.type === "JSXMemberExpression") return `${jsxNameName(name.object)}.${jsxNameName(name.property)}`;
    return "";
}

function isInsideElement(node, names) {
    let current = node.parent;
    while (current) {
        if (current.type === "JSXElement" && names.has(jsxNameName(current.openingElement.name))) return true;
        current = current.parent;
    }
    return false;
}

function hasText(value) {
    return typeof value === "string" && TEXT_RE.test(value);
}

function normalizeText(value) {
    return value.trim().replace(/\s+/g, " ");
}

function isIgnorableJsxText(value) {
    const text = value.trim();
    return ENTITY_OR_SYMBOL_RE.test(text) || INLINE_UNIT_RE.test(text);
}

function isLiteralSourceExpression(expression) {
    return (
        (expression.type === "Literal" && typeof expression.value === "string") ||
        (expression.type === "TemplateLiteral" && expression.expressions.length === 0)
    );
}

function literalSourceText(expression) {
    if (expression.type === "Literal" && typeof expression.value === "string") return expression.value;
    if (expression.type === "TemplateLiteral" && expression.expressions.length === 0) {
        return expression.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
    }
    return "";
}

function literalAttributeText(value) {
    if (!value) return "";
    if (value.type === "Literal") return String(value.value ?? "");
    if (value.type === "JSXExpressionContainer" && isLiteralSourceExpression(value.expression)) {
        return literalSourceText(value.expression);
    }
    return "";
}

function contextFilename(context) {
    return (
        context.filename ??
        context.getFilename?.() ??
        context.sourceCode?.filename ??
        context.sourceCode?.physicalFilename ??
        ""
    ).replace(/\\/g, "/");
}

function firstMismatch(actual, expected) {
    for (let i = 0; i < actual.length; i++) {
        if (actual[i] !== expected[i]) return { index: i, actual: actual[i], expected: expected[i] };
    }
    return null;
}

function readLocale(fileName, directory = localesDir) {
    const filePath = path.join(directory, fileName);
    return { fileName, filePath, json: JSON.parse(fs.readFileSync(filePath, "utf8")) };
}

function checkLocaleAlignment(directory = localesDir, root = projectRoot) {
    if (!fs.existsSync(directory)) return [];

    const localeFiles = fs
        .readdirSync(directory)
        .filter((name) => name.endsWith(".json"))
        .sort((a, b) => a.localeCompare(b));
    if (localeFiles.length <= 1) return [];

    const locales = localeFiles.map((fileName) => {
        const locale = readLocale(fileName, directory);
        const keys = Object.keys(locale.json);
        return { ...locale, keys, keySet: new Set(keys) };
    });
    const messages = [];

    for (let i = 0; i < locales.length - 1; i++) {
        for (let j = i + 1; j < locales.length; j++) {
            const left = locales[i];
            const right = locales[j];
            const onlyLeft = left.keys.filter((key) => !right.keySet.has(key));
            const onlyRight = right.keys.filter((key) => !left.keySet.has(key));

            if (onlyLeft.length > 0 || onlyRight.length > 0) {
                messages.push(
                    `${path.relative(root, left.filePath)} and ${path.relative(
                        root,
                        right.filePath,
                    )} do not have the same locale keys: ` +
                        `${onlyLeft.length} only in ${left.fileName}, ${onlyRight.length} only in ${right.fileName}.`,
                );
                for (const key of onlyLeft) {
                    messages.push(`${right.fileName} missing key from ${left.fileName}: ${JSON.stringify(key)}`);
                }
                for (const key of onlyRight) {
                    messages.push(`${left.fileName} missing key from ${right.fileName}: ${JSON.stringify(key)}`);
                }
                continue;
            }

            const mismatch = firstMismatch(left.keys, right.keys);
            if (!mismatch) continue;

            messages.push(
                `${path.relative(root, left.filePath)} and ${path.relative(root, right.filePath)} key order is not aligned: ` +
                    `entry ${mismatch.index + 1} is ${JSON.stringify(mismatch.actual)} in ${left.fileName}, ` +
                    `${JSON.stringify(mismatch.expected)} in ${right.fileName}.`,
            );
        }
    }

    return messages;
}

const useI18nBoundaryRule = {
    meta: {
        type: "problem",
        docs: {
            description: "Enforce OpenNeato's T/t i18n usage boundary.",
        },
        schema: [
            {
                type: "object",
                properties: {
                    allowedText: {
                        type: "array",
                        items: { type: "string" },
                    },
                    ignoredElements: {
                        type: "array",
                        items: { type: "string" },
                    },
                    translatableAttributes: {
                        type: "array",
                        items: { type: "string" },
                    },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            literalText: "Wrap literal JSX text in <T>...</T>.",
            literalExpression: "Wrap literal JSX source text in <T>...</T> instead of rendering it directly.",
            stringAttribute: "Use t(...) for user-facing string prop or attribute '{{name}}'.",
            dynamicT: "Use <T> only with plain JSX text. Use t(...) for programmatic text.",
            tProps: "Use <T> without props. Use t(...) for interpolation or programmatic text.",
        },
    },
    create(context) {
        const options = context.options?.[0] ?? {};
        const allowedText = new Set([...DEFAULT_ALLOWED_TEXT, ...(options.allowedText ?? [])]);
        const ignoredElements = new Set([...DEFAULT_IGNORED_ELEMENTS, ...(options.ignoredElements ?? [])]);
        const translatableAttrs = new Set([...DEFAULT_TRANSLATABLE_ATTRS, ...(options.translatableAttributes ?? [])]);

        return {
            JSXText(node) {
                if (
                    !hasText(node.value) ||
                    allowedText.has(normalizeText(node.value)) ||
                    isIgnorableJsxText(node.value) ||
                    isInsideElement(node, ignoredElements) ||
                    isInsideElement(node, new Set(["T"]))
                ) {
                    return;
                }
                context.report({ node, messageId: "literalText" });
            },
            JSXExpressionContainer(node) {
                if (isInsideElement(node, ignoredElements) || isInsideElement(node, new Set(["T"]))) return;
                if (!node.parent || node.parent.type !== "JSXElement") return;
                if (!isLiteralSourceExpression(node.expression)) return;
                const text = literalSourceText(node.expression);
                if (!hasText(text) || allowedText.has(normalizeText(text))) return;
                context.report({ node, messageId: "literalExpression" });
            },
            JSXAttribute(node) {
                const name = jsxNameName(node.name);
                if (!translatableAttrs.has(name)) return;
                const text = literalAttributeText(node.value);
                if (!hasText(text) || allowedText.has(normalizeText(text))) return;
                context.report({ node: node.value, messageId: "stringAttribute", data: { name } });
            },
            JSXElement(node) {
                if (jsxNameName(node.openingElement.name) !== "T") return;
                for (const attribute of node.openingElement.attributes) {
                    context.report({ node: attribute, messageId: "tProps" });
                }
                for (const child of node.children) {
                    if (child.type === "JSXText") continue;
                    context.report({ node: child, messageId: "dynamicT" });
                }
            },
        };
    },
};

function createLocalesAlignedRule(checkAlignment = checkLocaleAlignment) {
    return {
        meta: {
            type: "problem",
            docs: {
                description: "Ensure all OpenNeato locale JSON files share the same grouped key order.",
            },
            schema: [],
            messages: {
                localeAlignment: "{{message}}",
            },
        },
        create(context) {
            return {
                Program(node) {
                    const filename = contextFilename(context);
                    if (!filename.endsWith("/src/i18n/index.tsx") && !filename.endsWith("src/i18n/index.tsx")) return;

                    for (const message of checkAlignment()) {
                        context.report({ node, messageId: "localeAlignment", data: { message } });
                    }
                },
            };
        },
    };
}

const localesAlignedRule = createLocalesAlignedRule();

export const __test__ = {
    checkLocaleAlignment,
    contextFilename,
    createLocalesAlignedRule,
    firstMismatch,
    hasText,
    isIgnorableJsxText,
    isInsideElement,
    isLiteralSourceExpression,
    jsxNameName,
    literalAttributeText,
    literalSourceText,
    localesAlignedRule,
    normalizeText,
    readLocale,
    useI18nBoundaryRule,
};

export default {
    meta: {
        name: "openneato-i18n",
    },
    rules: {
        "locales-aligned": localesAlignedRule,
        "use-i18n-boundary": useI18nBoundaryRule,
    },
};
