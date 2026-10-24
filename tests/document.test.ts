import { describe, it, expect } from "vitest";
import rulesFile from "../rules/rules.json";
import { buildDocument, htmlToBlocks, length, textToBlocks } from "../src/engine/document";
import { analyse, byCategory, compileRules, sentences, type RulesFile } from "../src/engine/rules";

const rules = compileRules(rulesFile as RulesFile);
const VERDICT = /\b(safe|clean|trusted|score|grade)\b/i;

describe("document engine (shared reader cases)", () => {
  it("quotes each finding exactly at its offsets, and answers every category", () => {
    const doc = buildDocument([
      "Terms of Service",
      "1. Disputes. Any dispute will be resolved by binding arbitration. Small claims are excluded.",
      "2. Your content. We may use your content to train our machine learning models. You can opt out.",
      "3. Changes. We may modify these Terms at any time without notice.",
    ]);
    const findings = analyse(doc, rules);
    expect(findings).toHaveLength(3);
    const body = Array.from(doc.body);
    for (const f of findings) expect(body.slice(f.start, f.end).join("")).toBe(f.quote);
    const results = byCategory(findings, rules);
    expect(results.map((r) => r.category)).toEqual(rules.categories);
    expect(results.find((r) => r.category === "data_sale")?.status).toBe("not_found");
    expect(JSON.stringify(results)).not.toMatch(VERDICT);
  });

  it("offsets count code points, so text after an emoji still lines up", () => {
    const doc = buildDocument(["😀 Intro text that is long enough to stand alone here.", "Any dispute will be resolved by binding arbitration under these terms."]);
    const [f] = analyse(doc, rules);
    expect(Array.from(doc.body).slice(f!.start, f!.end).join("")).toBe(f!.quote);
  });

  it("never treats a heading as a finding", () => {
    expect(analyse(buildDocument(["AI Features, Training, and Your Data", "This section covers accounts, billing and support for every plan we offer today."]), rules)).toEqual([]);
  });

  it("splits sentences at terminators followed by a space, and at line breaks", () => {
    const text = "First one. Second one!  Third; fourth";
    const r = Array.from(text);
    expect(sentences(text).map((s) => r.slice(s.start, s.end).join(""))).toEqual(["First one.", "Second one!", "Third;", "fourth"]);
  });

  it("drops scripts and styles, joins a short heading to its clause on its own line", () => {
    const html = `<html><head><title>x</title><script>var a = "binding arbitration";</script></head>
<body><nav>Home</nav><h2>Disputes</h2><p>Any dispute will be resolved by binding arbitration under these terms.</p>
<style>.p{}</style><p>Short.</p><p>We may modify these Terms at any time without notice to you, as described here.</p></body></html>`;
    const doc = buildDocument(htmlToBlocks(html));
    expect(doc.body).not.toContain("var a");
    expect(doc.body).not.toContain(".p{}");
    expect(doc.clauses[0]!.text.startsWith("Home\nDisputes\nAny dispute")).toBe(true);
    for (const c of doc.clauses) expect(Array.from(doc.body).slice(c.start, c.start + length(c.text)).join("")).toBe(c.text);
    expect(analyse(doc, rules)).toHaveLength(2);
  });

  it("never throws on malformed HTML", () => {
    for (const p of ["", "<", "<p><p><p>", "<script>never closed", "\x00\xff<a href=", "<div>".repeat(5000)]) {
      expect(() => buildDocument(htmlToBlocks(p))).not.toThrow();
    }
  });

  it("splits plain text on blank lines", () => {
    expect(textToBlocks("One line\ncontinues\n\n\nTwo")).toEqual(["One line continues", "Two"]);
  });
});
