// Edges the mutation run (npm run mutation) found untested: each limit is
// checked on both sides, and the fail-safe paths are forced to run.

import { describe, it, expect, vi, afterEach } from "vitest";
import { RE2JS } from "re2js";
import rulesFile from "../rules/rules.json";
import { compileRules, type RulesFile } from "../src/engine/rules";
import { compileUnsigned, mergeRules, MAX_OWN_RULES, MAX_UNSIGNED_PATTERNS, ownRuleProblem, parseImport, type OwnRule } from "../src/engine/rule-set";
import { refreshRules } from "../src/engine/rules-update";
import { validateAiFindings } from "../src/ai/validate";
import { validateSummary } from "../src/ai/summary";
import { patternProblem, PATTERN_LIMITS } from "../src/engine/pattern-check";

const base = compileRules(rulesFile as RulesFile);
const known = base.categories;
const own = (over: Partial<OwnRule> = {}): OwnRule => ({
  id: "own-x",
  title: "Crypto payments",
  category: "auto_renewal",
  all: ["\\bpayments?\\b"],
  none: ["\\bnot\\b"],
  examples: { match: ["All payments are final."], noMatch: ["Payments are not final."] },
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("unsigned rules when re2js cannot read a pattern", () => {
  it("a must-not-match that fails always excludes, a must-match that fails never matches: the rule finds nothing", () => {
    const rule = compileUnsigned({ id: "x", category: "ai_training", all: ["\\btrain\\b"], none: ["\\bnot\\b"] }, known, { parse: false });
    const spy = vi.spyOn(RE2JS, "compile").mockImplementation(() => {
      throw new Error("unreadable");
    });
    expect(rule.all[0]!.test("we train models")).toBe(false);
    expect(rule.none[0]!.test("we train models")).toBe(true);
    // Compiled once, then remembered as unreadable.
    rule.all[0]!.test("again");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("by default a pattern is parsed when the rule is written, so a mistake is named at once", () => {
    vi.spyOn(RE2JS, "compile").mockImplementation(() => {
      throw new Error("unreadable");
    });
    expect(() => compileUnsigned({ id: "x", category: "ai_training", all: ["\\btrain\\b"], none: [] }, known)).toThrow(/not a valid regular expression/);
    // Loading rules for a page parses nothing up front.
    expect(() => compileUnsigned({ id: "x", category: "ai_training", all: ["\\btrain\\b"], none: [] }, known, { parse: false })).not.toThrow();
  });

  it("loading rules for a page compiles nothing until a sentence is tested", () => {
    const spy = vi.spyOn(RE2JS, "compile");
    mergeRules(base, { disabled: [], own: [own()] });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("rule limits, both sides", () => {
  it("patterns per list: 8 allowed, 9 refused", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `\\bword${i}\\b`);
    expect(() => compileUnsigned({ id: "x", category: "ai_training", all: eight, none: [] }, known)).not.toThrow();
    expect(() => compileUnsigned({ id: "x", category: "ai_training", all: [...eight, "\\bnine\\b"], none: [] }, known)).toThrow(/at most 8/);
  });

  it("an id, at least one must-match pattern, and an object are required", () => {
    expect(() => compileUnsigned({ id: "", category: "ai_training", all: ["a"], none: [] }, known)).toThrow(/needs an id/);
    expect(() => compileUnsigned({ id: "x", category: "ai_training", all: [], none: [] }, known)).toThrow(/at least one/);
    expect(() => compileUnsigned({ id: "x", category: "ai_training", all: "a" as never, none: [] }, known)).toThrow(/at least one/);
    expect(ownRuleProblem(null as never, known)).toBe("Not a rule.");
    expect(ownRuleProblem({ ...own(), examples: { match: ["x"] } } as never, known)).toMatch(/add the example/);
    expect(ownRuleProblem({ ...own(), examples: undefined } as never, known)).toMatch(/add the example/);
    expect(ownRuleProblem(own({ examples: { match: ["All payments are final."], noMatch: [] } }), known)).toMatch(/at least one/);
  });

  it("a name of 120 characters is allowed, 121 refused", () => {
    expect(ownRuleProblem(own({ title: "a".repeat(120) }), known)).toBeNull();
    expect(ownRuleProblem(own({ title: "a".repeat(121) }), known)).toMatch(/name/);
  });

  it("10 examples of each kind are allowed, 11 refused, either kind", () => {
    const yes = Array.from({ length: 10 }, (_, i) => `Payments ${i} are final.`);
    const no = Array.from({ length: 10 }, (_, i) => `Payments ${i} are not final.`);
    expect(ownRuleProblem(own({ examples: { match: yes, noMatch: no } }), known)).toBeNull();
    expect(ownRuleProblem(own({ examples: { match: [...yes, "Payments are final too."], noMatch: no } }), known)).toMatch(/at most 10/);
    expect(ownRuleProblem(own({ examples: { match: yes, noMatch: [...no, "Payments are not final too."] } }), known)).toMatch(/at most 10/);
  });

  it("an example of 1000 characters is allowed, 1001 refused", () => {
    const long = (n: number) => "Payments are final " + "x".repeat(n - "Payments are final ".length);
    expect(ownRuleProblem(own({ examples: { match: [long(1000)], noMatch: ["Payments are not final."] } }), known)).toBeNull();
    expect(ownRuleProblem(own({ examples: { match: [long(1001)], noMatch: ["Payments are not final."] } }), known)).toMatch(/too long/);
  });

  it("an import of exactly 512 KB is read; one byte more is refused", () => {
    const pack = JSON.stringify({ rules: [{ ...own(), id: undefined }] });
    const padded = (size: number) => pack.slice(0, -1) + " ".repeat(size - pack.length) + "}";
    expect(parseImport(padded(512 * 1024), known)).toHaveLength(1);
    expect(() => parseImport(padded(512 * 1024 + 1), known)).toThrow(/too large/);
  });

  it(`${MAX_OWN_RULES} rules may be imported, one more is refused`, () => {
    const rule = { ...own(), id: undefined };
    expect(parseImport(JSON.stringify({ rules: Array.from({ length: MAX_OWN_RULES }, () => rule) }), known)).toHaveLength(MAX_OWN_RULES);
    expect(() => parseImport(JSON.stringify({ rules: Array.from({ length: MAX_OWN_RULES + 1 }, () => rule) }), known)).toThrow(/At most 200/);
  });

  it(`${MAX_UNSIGNED_PATTERNS} patterns may be imported in all, one more is refused`, () => {
    const four = { ...own(), id: undefined, all: ["\\bpayments?\\b", "\\bfinal\\b", "\\bare\\b"], none: ["\\bnot\\b"] };
    const ok = Array.from({ length: MAX_UNSIGNED_PATTERNS / 4 }, () => four);
    expect(parseImport(JSON.stringify({ rules: ok }), known)).toHaveLength(ok.length);
    const over = [...ok.slice(1), { ...four, all: [...four.all, "\\ball\\b"] }];
    expect(() => parseImport(JSON.stringify({ rules: over }), known)).toThrow(/patterns in all/);
  });
});

describe("other edges", () => {
  it("the daily rules check asks nothing, and reports no update, within the day", async () => {
    const data: Record<string, unknown> = { "rules:checkedAt": 1_000_000 };
    const kv = { get: async (k: string) => data[k], set: async () => undefined, remove: async () => undefined };
    const fetchFn = vi.fn();
    expect(await refreshRules(kv as never, rulesFile as RulesFile, fetchFn as never, 1_000_000 + 60_000)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });


  it("an AI answer is looked for in the first twenty brackets only, and an array of words is no answer", () => {
    const body = "We may use the content you upload to train our machine learning models and improve them.";
    const finding = JSON.stringify([{ category: "ai_training", quote: body, explanation: "" }]);
    const noisy = "[a] ".repeat(19) + finding;
    expect(validateAiFindings(noisy, body, ["ai_training"], 8)).toHaveLength(1); // the 20th bracket
    expect(validateAiFindings("[a] " + noisy, body, ["ai_training"], 8)).toEqual([]); // the 21st is not read
    expect(validateAiFindings('["just", "words"]', body, ["ai_training"], 8)).toEqual([]);
    expect(validateAiFindings("[] then " + finding, body, ["ai_training"], 8)).toHaveLength(1);
  });

  it("a summary sentence of 300 characters is kept, while one of 301 and an empty one are dropped", () => {
    const s = (n: number) => "The service may share " + "data ".repeat(100).slice(0, n - "The service may share .".length) + ".";
    expect(validateSummary(JSON.stringify([{ text: s(300), quotes: [1] }]), 1)).toHaveLength(1);
    expect(validateSummary(JSON.stringify([{ text: s(301), quotes: [1] }]), 1)).toHaveLength(0);
    expect(validateSummary(JSON.stringify([{ text: "   ", quotes: [1] }]), 1)).toHaveLength(0);
  });
});

describe("the linear-time pattern check, by example", () => {
  // Each of these backtracks catastrophically somewhere; every one must be refused.
  const slow = ["(a+)+", "(a|a)*", "(a|ab)*c", "(\\w+\\s?)+$", "(x+x+)+y", "((ab)*)+", "(a*)*", "(.*a){12}", "^(a|aa)+$", "(\\d+)*\\d",
    "(a?){30}a{30}", "(\\w|\\d)+x", "([a-z]+)*$", "(a+){2,}b", "(.*,){20}x", "\\s*(\\s*)*x", "(a+b?)+c", "(ab|a)*b",
    "\\w*\\w*\\w*\\w*\\w*x", ".*.*.*.*.*x", "(\\s|\\w)+x", "(a|b|ab)*c", "(a{1,100}){1,100}b", "([a-z]|\\w)*x", "(\\bfoo\\b.*){10}"];
  it.each(slow)("refuses %s", (p) => expect(patternProblem(p)).not.toBeNull());

  const fine = ["\\bterminate\\b", "\\bmay (share|sell)\\b", "\\b(arbitration|arbitrate)\\b.{0,80}\\bbinding\\b", "^\\s*section\\b",
    "\\bauto(matic(ally)?)?[- ]renew", "[a-z]{2,20}@", "\\b(we|our) (may )?(collect|use)\\b", "[!-~]", "a{0,200}", "x$"];
  it.each(fine)("accepts %s", (p) => expect(patternProblem(p)).toBeNull());

  it("a pattern of the maximum length is accepted, one character more is refused", () => {
    expect(patternProblem("a".repeat(PATTERN_LIMITS.length))).toBeNull();
    expect(patternProblem("a".repeat(PATTERN_LIMITS.length + 1))).toMatch(/at most/);
  });

  it("a class range stays in printable ASCII, both ends included", () => {
    expect(patternProblem("[ -~]")).toBeNull();
    expect(patternProblem("[\u001f-~]")).toMatch(/printable ASCII/);
    expect(patternProblem("[ -\u007f]")).toMatch(/printable ASCII/);
    expect(patternProblem("[a")).not.toBeNull();
  });
});

describe("shared quotes", () => {
  it("a quote of 500 characters is shared whole, one of 501 is cut with an ellipsis", async () => {
    const { quoteText } = await import("../src/ui/share");
    expect(quoteText("example.com", "terms", "a".repeat(500))).toContain(`“${"a".repeat(500)}”`);
    expect(quoteText("example.com", "terms", "a".repeat(501))).toContain(`“${"a".repeat(500)}…”`);
  });
});
