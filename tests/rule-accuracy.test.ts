import { describe, expect, it } from "vitest";
import rulesFile from "../rules/rules.json";
import { buildDocument, textToBlocks } from "../src/engine/document";
import { analyse, byCategory, compileRules, type RulesFile } from "../src/engine/rules";
import { applyRuleEdit, MAX_UNSIGNED_PATTERNS, mergeRules, ownCollectionProblem, ownRuleProblem, parseImport, type OwnRule } from "../src/engine/rule-set";
import { reportCards } from "../src/ui/report";
import type { KV } from "../src/storage";

const rules = compileRules(rulesFile as RulesFile);
const find = (text: string) => analyse(buildDocument(textToBlocks(text)), rules);
const own = (over: Partial<OwnRule> = {}): OwnRule => ({ id: "own-payments", title: "Payments", category: "auto_renewal", all: ["payments", "cryptocurrency"], none: ["\\bnot\\b"], examples: { match: ["All payments for this subscription are made in cryptocurrency."], noMatch: ["All payments for this subscription are not made in cryptocurrency."] }, ...over });
const memory = () => {
  const data = new Map<string, unknown>();
  const kv: KV = { get: async (key) => structuredClone(data.get(key)), set: async (key, value) => { data.set(key, structuredClone(value)); }, remove: async (key) => { data.delete(key); } };
  return { kv, data };
};

describe("permissions, denials and qualifications", () => {
  it.each([
    ["We will not change these terms without notice to you.", "unilateral_change", false],
    ["We may sell personal data to advertisers unless you opt out.", "data_sale", true],
    ["Your subscription renews automatically and we will send a reminder before billing.", "auto_renewal", true],
    ["We do not require consent and may use your content to train our AI models.", "ai_training", true],
    ["We do not sell personal data, except that we sell personal data to advertising partners.", "data_sale", true],
    ["We do not sell personal information except with your consent when you enable partner offers.", "data_sale", true],
    ["We do not sell personal data, but we share only anonymous statistics with partners.", "data_sale", false],
    ["You have the right to know whether we sell personal data and to opt out of sales.", "data_sale", false],
  ])("%s", (text, category, expected) => {
    expect(find(text).some((f) => f.category === category)).toBe(expected);
    for (const finding of find(text)) expect(finding.quote).toBe(text);
  });

  it("retains every later match instead of only the first in a clause", () => {
    const first = "Your subscription automatically renews at the current price until you cancel.";
    const second = "Your second subscription automatically renews each month at its current price.";
    const found = find(`${first} ${second}`).filter((f) => f.ruleId === "automatic-renewal");
    expect(found.map((f) => f.quote)).toEqual([first, second]);
  });

  it("preserves adjacent sentences, paragraphs, list items and Unicode offsets", () => {
    const doc = buildDocument(["😀 Personal information shared with other organisations is described in the following section.", "We may sell personal data to advertising partners under these terms.", "This applies only if you consent to the partner offer and you may withdraw consent later."]);
    const finding = analyse(doc, rules).find((f) => f.category === "data_sale")!;
    expect(finding.context?.text).toContain("only if you consent");
    expect(finding.context?.text).toContain("😀");
    const points = Array.from(doc.body);
    expect(points.slice(finding.start, finding.end).join("")).toBe(finding.quote);
    expect(points.slice(finding.context!.start, finding.context!.end).join("")).toBe(finding.context!.text);
  });

  it("matches a list introduction with its adjacent item without fabricating a sentence", () => {
    for (const intro of ["We collect:", "We collect the following types of information from your device:"]) {
      const doc = buildDocument([intro, "Precise location data from your device."]);
      const finding = analyse(doc, rules).find((f) => f.category === "location_biometric");
      expect(finding).toBeDefined();
      expect(finding?.matchKind).toBe("list");
      expect(Array.from(doc.body).slice(finding!.start, finding!.end).join("")).toBe(finding?.quote);
    }
    for (const intro of ["We do not collect:", "We avoid collecting:", "We collect information from your device, excluding:"]) {
      const denied = buildDocument([intro, "Precise location data from your device for any reason."]);
      expect(analyse(denied, rules).some((f) => f.category === "location_biometric"), intro).toBe(false);
    }
  });

  it("does not combine independent paragraphs into a new permission", () => {
    const doc = buildDocument(["We may use the information provided to operate the service and answer support requests.", "Your content is private and remains available in your account until you delete it.", "Our staff train on AI safety and machine learning research each week."]);
    expect(analyse(doc, rules).some((f) => f.category === "ai_training")).toBe(false);
  });

  it("shows exact qualifications and surrounding evidence without a categorical paraphrase", () => {
    const doc = buildDocument(["We may sell personal data to advertisers unless you opt out.", "This applies only in regions where you have consented to these offers."]);
    const findings = analyse(doc, rules);
    const cards = reportCards({ site: "service.example", documents: [{ kind: "privacy", status: "read", url: "https://service.example/privacy", readAt: new Date().toISOString(), body: doc.body, categories: byCategory(findings, rules) }] });
    const card = cards.find((c) => c.querySelector("details"))!;
    expect(card.querySelector("summary")?.textContent).toBe("Show surrounding text");
    expect(card.textContent).toContain("unless you opt out.");
    expect(card.querySelector("details")?.textContent).toContain("only in regions");
    expect(card.textContent).not.toContain("Personal data may be sold, rented");
  });
});

describe("custom rule validation uses the scan engine", () => {
  it("rejects short positives and patterns that only match across sentence boundaries", () => {
    expect(ownRuleProblem(own({ all: ["payments"], examples: { match: ["All payments are final."], noMatch: ["No charges."] } }), rules.categories)).toContain("at least 8 words");
    const crossing = own({ examples: { match: ["All payments for this subscription are final after purchase. Cryptocurrency can be used for a separate service."], noMatch: ["No charges."] } });
    expect(ownRuleProblem(crossing, rules.categories)).toContain("does not match");
    expect(ownRuleProblem(own(), rules.categories)).toBeNull();
    expect(ownRuleProblem(own(), rules.categories, 12)).toContain("at least 12 words");
  });
  it("rejects a negative example if any eligible sentence matches", () => {
    const negative = "You do not need to pay any additional fee. All payments for this subscription are made in cryptocurrency.";
    expect(ownRuleProblem(own({ examples: { match: own().examples.match, noMatch: [negative] } }), rules.categories)).toContain("must not");
  });
  it("preserves assertion scope on export/import and rejects unknown scopes", () => {
    const scoped = own({ scope: "assertion" });
    expect(parseImport(JSON.stringify({ rules: [scoped] }), rules.categories)[0]?.scope).toBe("assertion");
    expect(() => parseImport(JSON.stringify({ rules: [{ ...scoped, scope: "unknown" }] }), rules.categories)).toThrow(/scope/);
  });
});

describe("combined custom-rule budgets and current storage", () => {
  it("checks the entire collection, including disabled rules, before adding or importing", async () => {
    const { kv, data } = memory();
    const existing = Array.from({ length: 150 }, (_, n) => own({ id: `own-${n}`, all: ["payments", "cryptocurrency", "subscription"], none: ["\\bnot\\b"] }));
    data.set("ownRules", existing);
    data.set("disabledRuleIds", existing.map((r) => r.id));
    expect(ownCollectionProblem(existing)).toBeNull();
    expect(ownCollectionProblem([...existing, own()])).toContain(String(MAX_UNSIGNED_PATTERNS));
    await expect(applyRuleEdit(kv, rules, { type: "add", rules: [own()] })).rejects.toThrow(/patterns across/);
    expect(data.get("ownRules")).toEqual(existing);
  });
  it("switches a signed rule back on while saved own rules are over budget, but not an own rule", async () => {
    const { kv, data } = memory();
    const over = Array.from({ length: 200 }, (_, n) => own({ id: `own-${n}`, all: ["payments", "cryptocurrency", "subscription"] }));
    data.set("ownRules", over);
    data.set("disabledRuleIds", ["binding-arbitration", "own-0"]);
    await applyRuleEdit(kv, rules, { type: "toggle", id: "binding-arbitration", on: true });
    expect(data.get("disabledRuleIds")).toEqual(["own-0"]);
    await expect(applyRuleEdit(kv, rules, { type: "toggle", id: "own-0", on: true })).rejects.toThrow(/patterns across/);
    expect(data.get("disabledRuleIds")).toEqual(["own-0"]);
  });
  it("applies sequential edits to fresh storage rather than a stale settings snapshot", async () => {
    const { kv, data } = memory();
    await applyRuleEdit(kv, rules, { type: "add", rules: [own({ id: "own-first" })] });
    await applyRuleEdit(kv, rules, { type: "add", rules: [own({ id: "own-second" })] });
    await applyRuleEdit(kv, rules, { type: "delete", id: "own-first" });
    expect((data.get("ownRules") as OwnRule[]).map((r) => r.id)).toEqual(["own-second"]);
    await applyRuleEdit(kv, rules, { type: "toggle", id: "own-second", on: false });
    expect(data.get("disabledRuleIds")).toEqual(["own-second"]);
    await applyRuleEdit(kv, rules, { type: "reset" });
    expect(data.get("ownRules")).toEqual([]);
  });
  it("rejects invalid examples and duplicate ids without writing any part of a pack", async () => {
    const { kv, data } = memory();
    const invalid = own({ id: "own-invalid", examples: { match: ["too short"], noMatch: ["nothing"] } });
    await expect(applyRuleEdit(kv, rules, { type: "add", rules: [own(), invalid] })).rejects.toThrow(/does not match/);
    expect(data.size).toBe(0);
    await expect(applyRuleEdit(kv, rules, { type: "add", rules: [own(), own()] })).rejects.toThrow(/unique/);
    expect(data.size).toBe(0);
  });
  it("names legacy rules that cannot run, including invalid regexes and over-budget rules", () => {
    const merged = mergeRules(rules, { disabled: [], own: [own({ id: "own-invalid", all: ["["] }), ...Array.from({ length: 151 }, (_, n) => own({ id: `own-${n}`, all: ["payments", "subscription", "cryptocurrency"], none: ["not"] }))] });
    expect(merged.skipped).toContain("own-invalid");
    expect(merged.skipped.some((id) => /^own-\d/.test(id))).toBe(true);
  });
});
