import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import rulesFile from "../rules/rules.json";
import fixtures from "../rules/rules_fixtures.json";
import { compileRules, ruleMatches, type RulesFile } from "../src/engine/rules";

const rules = compileRules(rulesFile as RulesFile);
const sets = (fixtures as { fixtures: Record<string, { match: string[]; noMatch: string[] }> }).fixtures;

describe("bundled rules (parity with the published fixtures)", () => {
  it("rules/README.md lists every rule", () => {
    const readme = readFileSync("rules/README.md", "utf8");
    for (const r of rules.rules) expect(readme, `README is missing ${r.id}`).toContain("`" + r.id + "`");
  });

  it("every rule has fixtures, and every fixture has a rule", () => {
    expect(Object.keys(sets).sort()).toEqual(rules.rules.map((r) => r.id).sort());
  });

  it.each(rules.rules.map((r) => [r.id, r] as const))("%s matches what it must and nothing it must not", (id, rule) => {
    for (const s of sets[id]!.match) expect(ruleMatches(rule, s), `${id} should match: ${s}`).toBe(true);
    for (const s of sets[id]!.noMatch) expect(ruleMatches(rule, s), `${id} must not match: ${s}`).toBe(false);
  });

  it.each([
    ["inline flags", { rules: [{ id: "x", category: "a", all: ["(?s)x"], none: [] }] }],
    ["an unknown category", { rules: [{ id: "x", category: "b", all: ["x"], none: [] }] }],
    ["a duplicate id", { rules: [{ id: "x", category: "a", all: ["x"], none: [] }, { id: "x", category: "a", all: ["y"], none: [] }] }],
    ["a rule with no pattern", { rules: [{ id: "x", category: "a", all: [], none: [] }] }],
    ["other flags", { flags: "is", rules: [{ id: "x", category: "a", all: ["x"], none: [] }] }],
  ])("refuses a rules file with %s", (_label, partial) => {
    expect(() => compileRules({ version: 1, flags: "i", minQuoteWords: 8, categories: ["a"], ...partial } as RulesFile)).toThrow();
  });
  it("refuses a rules file with rules but no categories", () => {
    expect(() => compileRules({ version: 1, flags: "i", minQuoteWords: 8, categories: [], rules: [{ id: "x", category: "a", all: ["x"], none: [] }] } as RulesFile)).toThrow();
  });
});
