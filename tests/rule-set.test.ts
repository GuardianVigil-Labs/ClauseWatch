import { describe, it, expect } from "vitest";
import rulesFile from "../rules/rules.json";
import { compileRules, type RulesFile } from "../src/engine/rules";
import { compileUnsigned, exportOwn, loadRules, MAX_UNSIGNED_PATTERNS, mergeRules, ownRuleProblem, parseImport, type OwnRule } from "../src/engine/rule-set";

const base = compileRules(rulesFile as RulesFile);
const known = base.categories;
const own = (over: Partial<OwnRule> = {}): OwnRule => ({
  id: "own-crypto-x",
  title: "Pays in crypto only",
  category: "auto_renewal",
  all: ["\\bpayments?\\b", "\\bcryptocurrenc(y|ies)\\b"],
  none: ["\\bnot\\b"],
  examples: { match: ["All payments are made in cryptocurrency."], noMatch: ["Payments are not made in cryptocurrency."] },
  ...over,
});
const ids = (r: { rules: { id: string }[] }) => r.rules.map((x) => x.id);

describe("the rule set", () => {
  it("merges: signed, minus switched off, plus own", () => {
    const merged = mergeRules(base, {
      disabled: ["binding-arbitration", "own-crypto-x"],
      own: [own(), own({ id: "own-other", title: "Other" })],
    });
    expect(ids(merged)).not.toContain("binding-arbitration");
    expect(ids(merged)).toContain("class-action-waiver");
    expect(ids(merged)).not.toContain("own-crypto-x"); // the person switched their own rule off
    expect(ids(merged)).toContain("own-other");
  });

  it("refuses a catastrophic or invalid pattern before it runs, and leaves such a rule out of the set", () => {
    expect(() => compileUnsigned({ id: "x", category: "ai_training", all: ["(a+)+$"], none: [] }, known)).toThrow();
    expect(() => compileUnsigned({ id: "x", category: "ai_training", all: ["(?=lookahead)"], none: [] }, known)).toThrow();
    expect(() => compileUnsigned({ id: "x", category: "nope", all: ["a"], none: [] }, known)).toThrow(/unknown topic/);
    const merged = mergeRules(base, { disabled: [], own: [own({ id: "own-bad", all: ["(a+)+$"] })] });
    expect(merged.skipped).toEqual(["own-bad"]);
    expect(ids(merged)).not.toContain("own-bad");
  });

  it("an own rule may not take a signed rule's id", () => {
    const merged = mergeRules(base, { disabled: [], own: [own({ id: "binding-arbitration" })] });
    expect(merged.skipped).toEqual(["binding-arbitration"]);
    expect(ids(merged).filter((i) => i === "binding-arbitration")).toHaveLength(1);
  });

  it("runs unsigned rules in linear time on hostile text", () => {
    const rule = compileUnsigned({ id: "x", category: "ai_training", all: ["a{1,200}b"], none: [] }, known);
    const start = Date.now();
    rule.all[0]!.test("a".repeat(200_000));
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("checks an own rule's examples before it is saved", () => {
    expect(ownRuleProblem(own(), known)).toBeNull();
    expect(ownRuleProblem(own({ examples: { match: ["Nothing about money."], noMatch: ["x"] } }), known)).toMatch(/does not match/);
    expect(ownRuleProblem(own({ examples: { match: ["All payments are made in cryptocurrency."], noMatch: ["Every payment is in cryptocurrency."] } }), known)).toMatch(/must not/);
    expect(ownRuleProblem(own({ examples: { match: [], noMatch: [] } }), known)).toMatch(/at least one/);
    expect(ownRuleProblem(own({ title: " " }), known)).toMatch(/name/);
  });

  it("imports a valid pack and refuses malformed, oversized or unsafe ones, keeping nothing", () => {
    const file = exportOwn([own()]);
    const back = parseImport(file, known);
    expect(back).toHaveLength(1);
    expect(back[0]!.id).toMatch(/^own-pays-in-crypto-only-/);
    expect(() => parseImport("not json", known)).toThrow(/JSON/);
    expect(() => parseImport(JSON.stringify({ rules: [] }), known)).toThrow(/rules/);
    expect(() => parseImport("x".repeat(600 * 1024), known)).toThrow(/too large/);
    const unsafe = JSON.parse(file);
    unsafe.rules.push({ ...unsafe.rules[0], title: "Bad", all: ["(a+)+$"] });
    expect(() => parseImport(JSON.stringify(unsafe), known)).toThrow();
  });

  it("loads stored choices and own rules", async () => {
    const data: Record<string, unknown> = { disabledRuleIds: ["binding-arbitration"], ownRules: [own()] };
    const kv = { get: async (k: string) => data[k], set: async () => undefined, remove: async () => undefined };
    const merged = await loadRules(kv as never, base);
    expect(ids(merged)).not.toContain("binding-arbitration");
    expect(ids(merged)).toContain("own-crypto-x");
  });

  it("leaves out malformed own rules instead of failing every scan", () => {
    const merged = mergeRules(base, { disabled: [], own: [null, 5, { id: 7 }, "x"] as never });
    expect(merged.rules.length).toBe(base.rules.length);
  });

  it("gives imported rules with the same title different ids", () => {
    const file = JSON.stringify({ rules: [{ ...own(), title: "Data sale" }, { ...own(), title: "data-sale!" }] });
    const [a, b] = parseImport(file, known);
    expect(a!.id).not.toBe(b!.id);
  });

  it("matches a non-breaking space as the browser does", () => {
    const rule = compileUnsigned({ id: "x", category: "ai_training", all: ["train\\s+our\\s+models"], none: [] }, known);
    expect(rule.all[0]!.test("we may train\u00a0our models")).toBe(true);
    expect(/train\s+our\s+models/i.test("we may train\u00a0our models")).toBe(true);
  });

  it("caps the patterns own rules may add", () => {
    // 200 own rules (the cap) of 4 patterns each: 800 patterns, of which 600 may run.
    const many = Array.from({ length: 250 }, (_, i) => own({ id: `own-${i}`, all: ["a", "b", "c", "d"], none: [] }));
    const merged = mergeRules(base, { disabled: [], own: many });
    expect(merged.rules.length - base.rules.length).toBe(MAX_UNSIGNED_PATTERNS / 4);
    expect(merged.skipped.length).toBe(200 - MAX_UNSIGNED_PATTERNS / 4);
  });

  it("leaves out a topic whose every rule is switched off, so it is never reported as not found", () => {
    const merged = mergeRules(base, { disabled: ["ai-training-on-user-content"], own: [] });
    expect(merged.categories).not.toContain("ai_training");
    expect(merged.categories).toContain("arbitration");
    expect(mergeRules(base, { disabled: ["binding-arbitration"], own: [] }).categories).toContain("arbitration");
  });

  it("a must-not-match pattern re2js cannot read makes the rule find nothing, never too much", () => {
    const rule = compileUnsigned({ id: "x", category: "ai_training", all: ["\\btrain\\b"], none: ["[[:alpha:]]"] }, known, { parse: false });
    expect(rule.all.every((p) => p.test("we train models")) && !rule.none.some((p) => p.test("we train models"))).toBe(false);
  });

  it("refuses an import with a non-rule entry or an empty example", () => {
    expect(() => parseImport(JSON.stringify({ rules: [null] }), known)).toThrow(/not a rule/);
    const blank = { ...own(), examples: { match: ["All payments are made in cryptocurrency."], noMatch: [" "] } };
    expect(() => parseImport(JSON.stringify({ rules: [blank] }), known)).toThrow(/empty/);
  });
});
