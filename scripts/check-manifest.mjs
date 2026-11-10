#!/usr/bin/env node
// The built manifests ask for no site access at install beyond the two GitHub
// hosts the daily rules download needs. Access to the sites a user visits is
// optional, requested when they turn on Automatic mode or click the button, as
// the store listing says. WXT adds a runtime content script's matches to
// host_permissions; wxt.config.ts removes them, and this fails the build if
// that ever stops happening. The permission list is pinned too: a new one
// needs a justification in docs/STORE_LISTING.md first.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// acorn is already installed (WXT parses with it); a parser sees through
// spacing, comments, strings and comma expressions that a pattern cannot.
import { parse } from "acorn";

/**
 * Where a script builds code from a string: a call or `new` of Function or
 * eval, by name or on the global object, also through `(0, eval)`, `a || eval` or
 * `c ? Function : f`; any other use of eval (`const e = eval`); and any
 * `x["eval"]` or `x["Function"]`. Returns the offsets found.
 */
function stringToCode(source) {
  let ast;
  try { ast = parse(source, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true }); }
  catch {
    try { ast = parse(source, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true }); }
    catch { return [-1]; } // unreadable: fail closed
  }
  const banned = (v) => v === "Function" || v === "eval";
  const literal = (n) => (n.type === "Literal" && banned(n.value)) || (n.type === "TemplateLiteral" && n.expressions.length === 0 && banned(n.quasis[0].value.cooked));
  // What a callee can evaluate to: the last of a comma expression, either side of || ?? &&, either branch of ?:.
  const callees = (n) => n.type === "SequenceExpression" ? callees(n.expressions.at(-1))
    : n.type === "LogicalExpression" ? [...callees(n.left), ...callees(n.right)]
    : n.type === "ConditionalExpression" ? [...callees(n.consequent), ...callees(n.alternate)]
    : n.type === "ChainExpression" ? callees(n.expression) : [n];
  // A property of the global object (`globalThis.eval`), not a method of the same name (`prefilter.eval`).
  const global = (n) => n.type === "Identifier" && /^(globalThis|window|self|global|frames|top|parent)$/.test(n.name);
  const named = (n) => (n.type === "Identifier" && banned(n.name)) || (n.type === "MemberExpression" && (n.computed ? literal(n.property) : global(n.object) && banned(n.property.name)));
  const found = [];
  const stack = [[ast, null, null]];
  while (stack.length) {
    const [n, parent, key] = stack.pop();
    if ((n.type === "CallExpression" || n.type === "NewExpression") && callees(n.callee).some(named)) found.push(n.start);
    else if (n.type === "MemberExpression" && n.computed && literal(n.property)) found.push(n.start);
    else if (n.type === "Identifier" && n.name === "eval") {
      const propertyName = (parent.type === "MemberExpression" && key === "property" && !parent.computed) || (/^(Property|MethodDefinition|PropertyDefinition)$/.test(parent.type) && key === "key" && !parent.computed && !parent.shorthand);
      if (!propertyName) found.push(n.start);
    }
    for (const [k, v] of Object.entries(n)) {
      for (const child of Array.isArray(v) ? v : [v]) if (child && typeof child.type === "string") stack.push([child, n, k]);
    }
  }
  return found;
}

// The check must still catch each form, and pass ordinary code.
const evasive = ["Function(source)()", "Function ('return this')()", "new Function('a', 'return a')", "new Function", "eval ('code')", "(0,eval)(source)", "(0, Function)(s)()", "globalThis.eval(s)", "window['eval'](s)", "top.Function(s)", "self.Function(s)", "const e = eval; e(s)", "(a || eval)(s)", "f(eval)", "x = { eval }", "Function/**/(s)", "Reflect.construct(globalThis[`Function`], [s])"];
for (const sample of evasive) if (stringToCode(sample).length === 0) { console.error(`self-test: missed ${sample}`); process.exit(1); }
const clean = "const o = { eval: 1, Function: 2 }; o.eval; o.Function; o.eval(s); this.subs[0].eval(t); new o.Function(s); class C { eval() {} } x instanceof Function; typeof Function; s.replace(\"eval(\", ''); // eval(s) Function(s)\nconst t = `new Function(${s})`;";
if (stringToCode(clean).length) { console.error("self-test: flagged clean code"); process.exit(1); }

const out = ".output";
const allowed = new Set(["https://github.com/*", "https://release-assets.githubusercontent.com/*"]);
const permissions = ["activeTab", "alarms", "contextMenus", "scripting", "storage"];
const builds = existsSync(out) ? readdirSync(out).filter((d) => existsSync(join(out, d, "manifest.json"))) : [];
if (builds.length === 0) {
  console.error("No build found: run `npm run build` first.");
  process.exit(1);
}
let failed = false;
for (const b of builds) {
  const m = JSON.parse(readFileSync(join(out, b, "manifest.json"), "utf8"));
  const extra = (m.host_permissions ?? []).filter((p) => !allowed.has(p));
  if (extra.length) {
    console.error(`${b}: host access asked for at install: ${extra.join(", ")}`);
    failed = true;
  } else console.log(`${b}: no site access at install beyond the rules download.`);
  const asked = [...(m.permissions ?? [])].sort();
  if (JSON.stringify(asked) !== JSON.stringify(permissions)) {
    console.error(`${b}: permissions ${asked.join(", ")}; expected ${permissions.join(", ")}`);
    failed = true;
  }
  if (m.web_accessible_resources) {
    console.error(`${b}: no web-accessible resources`);
    failed = true;
  }
  // Rule signatures need WebCrypto Ed25519.
  const min = b.startsWith("firefox") ? m.browser_specific_settings?.gecko?.strict_min_version : m.minimum_chrome_version;
  const need = b.startsWith("firefox") ? 140 : 137;
  if (!(parseInt(min, 10) >= need)) {
    console.error(`${b}: minimum browser version must be at least ${need} (found ${min ?? "none"})`);
    failed = true;
  }
  // No string-to-code calls in the shipped scripts (store reviewers flag them).
  const scripts = readdirSync(join(out, b), { recursive: true }).filter((f) => /\.m?js$/.test(f));
  for (const f of scripts) {
    if (stringToCode(readFileSync(join(out, b, f), "utf8")).length) {
      console.error(`${b}: ${f} builds code from a string (Function or eval)`);
      failed = true;
    }
  }
  // The licence ships with every build (Apache-2.0 §4).
  for (const f of ["LICENSE", "NOTICE"]) {
    if (!existsSync(join(out, b, f))) {
      console.error(`${b}: ${f} is missing from the build`);
      failed = true;
    }
  }
}
process.exit(failed ? 1 : 0);
