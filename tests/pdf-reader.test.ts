// @vitest-environment node
import { describe, expect, it } from "vitest";
import { makePdf } from "./helpers/pdf";
import rulesFile from "../rules/rules.json";
import { compileRules, type RulesFile } from "../src/engine/rules";
import { readDocument } from "../src/engine/documents";
import { extractPdf } from "../src/engine/pdf-text";

describe("local PDF text extraction", () => {
  it("extracts actual PDF text with headings and sentence boundaries", async () => {
    const clause = "Any dispute arising from this agreement will be resolved by binding arbitration rather than in court.";
    const text = await extractPdf(makePdf(`Terms of Service\n${clause}`));
    expect(text).toContain("Terms of Service");
    expect(text).toContain(clause);
    const result = readDocument("terms", "https://service.example/policy.pdf", text, "text/plain", compileRules(rulesFile as RulesFile));
    expect(result.status).toBe("read");
    if (result.status === "read") expect(result.categories.find((c) => c.category === "arbitration")?.findings[0]?.quote).toBe(clause);
  });
  it("rejects corrupt and image-only PDFs instead of claiming a policy was checked", async () => {
    await expect(extractPdf(new TextEncoder().encode("%PDF-broken"))).rejects.toBeDefined();
    await expect(extractPdf(makePdf(""))).rejects.toThrow(/no extractable text/);
  });
  it("bounds page count before extracting a large document", async () => {
    await expect(extractPdf(makePdf("Policy", 101))).rejects.toThrow(/100 pages/);
  });
});
