import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import plugin, { __test__ } from "./oxlint_i18n_plugin.js";

function id(name) {
    return { type: "JSXIdentifier", name };
}

function literal(value) {
    return { type: "Literal", value };
}

function template(value, expressions = []) {
    return { type: "TemplateLiteral", expressions, quasis: [{ value: { cooked: value, raw: value } }] };
}

function text(value) {
    return { type: "JSXText", value };
}

function expression(expressionNode) {
    return { type: "JSXExpressionContainer", expression: expressionNode };
}

function attribute(name, value) {
    return { type: "JSXAttribute", name: id(name), value };
}

function element(name, children = [], attributes = []) {
    const node = {
        type: "JSXElement",
        openingElement: { name: id(name), attributes },
        children,
    };
    for (const child of children) child.parent = node;
    for (const attr of attributes) attr.parent = node;
    return node;
}

function ruleReports(options = {}) {
    const reports = [];
    const context = {
        options: Object.keys(options).length > 0 ? [options] : [],
        report: (report) => reports.push(report),
    };
    return { reports, visitors: __test__.useI18nBoundaryRule.create(context) };
}

function reportIds(reports) {
    return reports.map((report) => report.messageId);
}

function tempLocales(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openneato-i18n-"));
    const dir = path.join(root, "locales");
    fs.mkdirSync(dir);
    for (const [name, json] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), `${JSON.stringify(json, null, 2)}\n`);
    }
    return { root, dir };
}

// Sanity check: oxlint sees the same rule names that frontend/.oxlintrc.json enables.
test("plugin exports the configured oxlint rules", () => {
    assert.equal(plugin.meta.name, "openneato-i18n");
    assert.equal(plugin.rules["locales-aligned"], __test__.localesAlignedRule);
    assert.equal(plugin.rules["use-i18n-boundary"], __test__.useI18nBoundaryRule);
});

// These helpers stand in for parsed JSX. For example, element("T", [text("Settings")])
// means <T>Settings</T>, and attribute("aria-label", literal("Back")) means aria-label="Back".
test("helper functions cover JSX names, text checks, literals, and filenames", () => {
    assert.equal(__test__.jsxNameName(null), "");
    assert.equal(__test__.jsxNameName(id("T")), "T");
    assert.equal(
        __test__.jsxNameName({ type: "JSXNamespacedName", namespace: id("aria"), name: id("label") }),
        "aria:label",
    );
    assert.equal(
        __test__.jsxNameName({ type: "JSXMemberExpression", object: id("Dialog"), property: id("Title") }),
        "Dialog.Title",
    );
    assert.equal(__test__.jsxNameName({ type: "Other" }), "");

    const child = text("Settings");
    element("T", [child]);
    assert.equal(__test__.isInsideElement(child, new Set(["T"])), true);
    assert.equal(__test__.isInsideElement(child, new Set(["code"])), false);
    assert.equal(__test__.isInsideElement(text("Settings"), new Set(["T"])), false);

    assert.equal(__test__.hasText("Settings"), true);
    assert.equal(__test__.hasText("123"), false);
    assert.equal(__test__.hasText(123), false);
    assert.equal(__test__.normalizeText("  Save   & Reboot  "), "Save & Reboot");
    assert.equal(__test__.isIgnorableJsxText(" &rsaquo; "), true);
    assert.equal(__test__.isIgnorableJsxText(" KB "), true);
    assert.equal(__test__.isIgnorableJsxText("Settings"), false);

    assert.equal(__test__.isLiteralSourceExpression(literal("Back")), true);
    assert.equal(__test__.isLiteralSourceExpression(literal(1)), false);
    assert.equal(__test__.isLiteralSourceExpression(template("Back")), true);
    assert.equal(__test__.isLiteralSourceExpression(template("Back", [id("label")])), false);
    assert.equal(__test__.literalSourceText(literal("Back")), "Back");
    assert.equal(
        __test__.literalSourceText({ type: "TemplateLiteral", expressions: [], quasis: [{ value: { raw: "Back" } }] }),
        "Back",
    );
    assert.equal(__test__.literalSourceText(id("label")), "");
    assert.equal(__test__.literalAttributeText(null), "");
    assert.equal(__test__.literalAttributeText(literal("Back")), "Back");
    assert.equal(__test__.literalAttributeText(literal(null)), "");
    assert.equal(__test__.literalAttributeText(expression(literal("Back"))), "Back");
    assert.equal(__test__.literalAttributeText(expression(id("label"))), "");

    assert.equal(__test__.contextFilename({ filename: "a\\b.tsx" }), "a/b.tsx");
    assert.equal(__test__.contextFilename({ getFilename: () => "from-getter.tsx" }), "from-getter.tsx");
    assert.equal(__test__.contextFilename({ sourceCode: { filename: "from-source.tsx" } }), "from-source.tsx");
    assert.equal(
        __test__.contextFilename({ sourceCode: { physicalFilename: "from-physical.tsx" } }),
        "from-physical.tsx",
    );
    assert.equal(__test__.contextFilename({}), "");
    assert.deepEqual(__test__.firstMismatch(["a", "b"], ["a", "c"]), { index: 1, actual: "b", expected: "c" });
    assert.equal(__test__.firstMismatch(["a"], ["a"]), null);
});

// JSX meaning:
// - <div>Settings</div> is user-facing text and should be flagged.
// - <T>Settings</T> is already translated and should pass.
// - <code>curl -X POST</code>, symbols, units, and configured app names are intentionally ignored.
test("use-i18n-boundary reports literal JSX text unless it is translated or ignorable", () => {
    const { reports, visitors } = ruleReports({ allowedText: ["DeviceName"] });
    const literalText = text("Settings");
    element("div", [literalText]);
    visitors.JSXText(literalText);
    visitors.JSXText(text("DeviceName"));
    visitors.JSXText(text("..."));
    visitors.JSXText(text(" KB "));

    const translated = text("Settings");
    element("T", [translated]);
    visitors.JSXText(translated);

    const codeText = text("curl -X POST");
    element("code", [codeText]);
    visitors.JSXText(codeText);

    assert.deepEqual(reportIds(reports), ["literalText"]);
});

// JSX meaning:
// - <div>{"Settings"}</div> and <div>{`Settings`}</div> are literal source strings rendered directly and should be
//   flagged.
// - <T>{"Settings"}</T> is intentionally ignored here because the JSXElement visitor reports it once for <T>.
// - <div>{label}</div> is dynamic data, not a literal source string, so this rule leaves it alone.
test("use-i18n-boundary reports literal JSX expressions outside T", () => {
    const { reports, visitors } = ruleReports();
    const literalExpression = expression(literal("Settings"));
    element("div", [literalExpression]);
    visitors.JSXExpressionContainer(literalExpression);

    const templateExpression = expression(template("Settings"));
    element("div", [templateExpression]);
    visitors.JSXExpressionContainer(templateExpression);

    const translated = expression(literal("Settings"));
    element("T", [translated]);
    visitors.JSXExpressionContainer(translated);

    const dynamic = expression(id("label"));
    element("div", [dynamic]);
    visitors.JSXExpressionContainer(dynamic);

    const allowed = expression(literal("OpenNeato"));
    element("div", [allowed]);
    visitors.JSXExpressionContainer(allowed);

    const numberOnly = expression(literal("123"));
    element("div", [numberOnly]);
    visitors.JSXExpressionContainer(numberOnly);

    const detached = expression(literal("Settings"));
    visitors.JSXExpressionContainer(detached);

    const codeExpression = expression(literal("Settings"));
    element("code", [codeExpression]);
    visitors.JSXExpressionContainer(codeExpression);

    assert.deepEqual(reportIds(reports), ["literalExpression", "literalExpression"]);
});

// JSX meaning:
// - aria-label="Back", placeholder={"Network password"}, and configured user-facing props should use t(...).
// - class="settings-card" is not user-facing and should pass.
// - title="OpenNeato" is allowed because OpenNeato is configured as a brand/static exception.
test("use-i18n-boundary reports user-facing string attributes", () => {
    const { reports, visitors } = ruleReports({ allowedText: ["OpenNeato"], translatableAttributes: ["data-title"] });
    visitors.JSXAttribute(attribute("aria-label", literal("Back")));
    visitors.JSXAttribute(attribute("placeholder", expression(literal("Network password"))));
    visitors.JSXAttribute(attribute("data-title", literal("Settings")));
    visitors.JSXAttribute(attribute("class", literal("settings-card")));
    visitors.JSXAttribute(attribute("title", literal("OpenNeato")));
    visitors.JSXAttribute(attribute("title", literal("...")));
    visitors.JSXAttribute(attribute("title", null));

    assert.deepEqual(reportIds(reports), ["stringAttribute", "stringAttribute", "stringAttribute"]);
    assert.deepEqual(reports.map((report) => report.data?.name).filter(Boolean), [
        "aria-label",
        "placeholder",
        "data-title",
    ]);
});

// JSX meaning:
// - <T>Settings</T> is plain JSX text and should pass.
// - <T>{"Settings"}</T>, <T>{`Settings`}</T>, and <T>{label}</T> should be flagged because <T> must not contain curly
//   brace expressions.
// - <T values={{ values }}>Uploading... {progress}%</T> should be flagged because interpolation belongs in t(...).
test("use-i18n-boundary keeps T static by rejecting props and dynamic children", () => {
    const { reports, visitors } = ruleReports();
    visitors.JSXElement(element("T", [text("Settings")]));
    visitors.JSXElement(element("T", [expression(literal("Settings"))]));
    visitors.JSXElement(element("T", [expression(template("Settings"))]));
    visitors.JSXElement(element("T", [expression(id("label"))]));
    visitors.JSXElement(
        element("T", [text("Uploading... {progress}%")], [attribute("values", expression(id("values")))]),
    );
    visitors.JSXElement(element("div", [expression(id("label"))]));

    assert.deepEqual(reportIds(reports), ["dynamicT", "dynamicT", "dynamicT", "tProps"]);
});

// Locale meaning:
// - With zero or one locale file there is nothing to compare, so alignment passes.
// - Multiple locale files pass only when they have the same keys in the same order.
test("checkLocaleAlignment accepts absent, empty, single, and aligned locale directories", () => {
    assert.deepEqual(__test__.checkLocaleAlignment(path.join(os.tmpdir(), "missing-openneato-locales")), []);

    const empty = tempLocales({});
    const single = tempLocales({ "tr.json": { Back: "Geri" } });
    const aligned = tempLocales({
        "de.json": { Back: "Zurück", Settings: "Einstellungen" },
        "tr.json": { Back: "Geri", Settings: "Ayarlar" },
    });
    try {
        assert.deepEqual(__test__.checkLocaleAlignment(empty.dir, empty.root), []);
        assert.deepEqual(__test__.checkLocaleAlignment(single.dir, single.root), []);
        assert.deepEqual(__test__.checkLocaleAlignment(aligned.dir, aligned.root), []);
        assert.equal(__test__.readLocale("tr.json", single.dir).json.Back, "Geri");
    } finally {
        fs.rmSync(empty.root, { recursive: true, force: true });
        fs.rmSync(single.root, { recursive: true, force: true });
        fs.rmSync(aligned.root, { recursive: true, force: true });
    }
});

// Locale meaning:
// - tr.json is missing "Settings" while de.json and fr.json have it.
// - The rule checks every pair, so both de-vs-tr and fr-vs-tr report the missing key.
test("checkLocaleAlignment reports missing keys pairwise", () => {
    const fixture = tempLocales({
        "de.json": { Back: "Zurück", Settings: "Einstellungen" },
        "fr.json": { Back: "Retour", Settings: "Paramètres" },
        "tr.json": { Back: "Geri" },
    });
    try {
        assert.deepEqual(__test__.checkLocaleAlignment(fixture.dir, fixture.root), [
            "locales/de.json and locales/tr.json do not have the same locale keys: 1 only in de.json, 0 only in tr.json.",
            'tr.json missing key from de.json: "Settings"',
            "locales/fr.json and locales/tr.json do not have the same locale keys: 1 only in fr.json, 0 only in tr.json.",
            'tr.json missing key from fr.json: "Settings"',
        ]);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

// Locale meaning:
// - Extra keys are reported from the opposite side as missing from the shorter file.
// - Files with the same keys still fail if their JSON key order differs.
test("checkLocaleAlignment reports extra keys and order mismatches pairwise", () => {
    const extra = tempLocales({
        "de.json": { Back: "Zurück" },
        "tr.json": { Back: "Geri", Settings: "Ayarlar" },
    });
    const unsorted = tempLocales({
        "de.json": { Back: "Zurück", Settings: "Einstellungen" },
        "tr.json": { Settings: "Ayarlar", Back: "Geri" },
    });
    try {
        assert.deepEqual(__test__.checkLocaleAlignment(extra.dir, extra.root), [
            "locales/de.json and locales/tr.json do not have the same locale keys: 0 only in de.json, 1 only in tr.json.",
            'de.json missing key from tr.json: "Settings"',
        ]);
        assert.deepEqual(__test__.checkLocaleAlignment(unsorted.dir, unsorted.root), [
            'locales/de.json and locales/tr.json key order is not aligned: entry 1 is "Back" in de.json, "Settings" in tr.json.',
        ]);
    } finally {
        fs.rmSync(extra.root, { recursive: true, force: true });
        fs.rmSync(unsorted.root, { recursive: true, force: true });
    }
});

// Oxlint integration meaning:
// - Locale alignment runs once from src/i18n/index.tsx, where npm run i18n:check points oxlint.
// - Other files such as dashboard.tsx skip this filesystem-level check to avoid duplicate reports.
test("locales-aligned rule only runs from the i18n entrypoint", () => {
    const skippedReports = [];
    const skippedVisitors = __test__.localesAlignedRule.create({
        filename: "/tmp/src/views/dashboard.tsx",
        report: (report) => skippedReports.push(report),
    });
    skippedVisitors.Program({ type: "Program" });
    assert.deepEqual(skippedReports, []);

    const reports = [];
    const visitors = __test__.localesAlignedRule.create({
        getFilename: () => "/tmp/src/i18n/index.tsx",
        report: (report) => reports.push(report),
    });
    visitors.Program({ type: "Program" });
    assert.deepEqual(reports, []);

    const reported = [];
    const reportingVisitors = __test__
        .createLocalesAlignedRule(() => ["first", "second"])
        .create({
            filename: "src/i18n/index.tsx",
            report: (report) => reported.push(report),
        });
    const node = { type: "Program" };
    reportingVisitors.Program(node);
    assert.deepEqual(reported, [
        { node, messageId: "localeAlignment", data: { message: "first" } },
        { node, messageId: "localeAlignment", data: { message: "second" } },
    ]);
});
