import { describe, it, expect } from "vitest";
import parity from "./fixtures/reader-parity.json";
import rulesFile from "../rules/rules.json";
import { buildDocument, htmlToBlocks } from "../src/engine/document";
import { readDocument } from "../src/engine/documents";
import { compileRules, type RulesFile } from "../src/engine/rules";

/**
 * How a page becomes text (docs/reader.md): identical body and clause
 * positions for these shared cases, so a quote and its place mean the same in
 * any implementation.
 */
describe("reading a page (shared cases)", () => {
  it.each(parity.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const doc = buildDocument(htmlToBlocks(c.html));
    expect(doc.body).toBe(c.body);
    expect(doc.clauses.map((x) => x.start)).toEqual(c.starts);
  });

  it("never quotes a consent dialog, and quotes inline text exactly", () => {
    const filler = "<p>This section explains how the service works and what each party agrees to under these terms in detail.</p>".repeat(30);
    const page = `<h1>Terms of Service</h1>${filler}
      <div id="consent-banner" role="region"><p>We may sell your personal information to partners when you press accept on this banner.</p><button>Accept</button></div>
      <div role="dialog"><p>We share your personal data with advertising partners to show you targeted ads.</p></div>
      <p>We may use the content you <a href="/u">upload</a> to train our machine learning models and improve them.</p>`;
    const r = readDocument("terms", "https://service.example/terms", page, "text/html", compileRules(rulesFile as RulesFile));
    if (r.status !== "read") throw new Error("not read");
    const quotes = r.categories.flatMap((c) => c.findings.map((f) => f.quote));
    expect(quotes).toEqual(["We may use the content you upload to train our machine learning models and improve them."]);
    expect(r.body).not.toMatch(/press accept|targeted ads/);
  });
});
