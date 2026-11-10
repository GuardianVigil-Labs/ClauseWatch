// @vitest-environment node
import { describe, expect, it } from "vitest";
import { makePdf, pdfFromContent, pdfString } from "./helpers/pdf";
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
  it("joins a word split across runs, and keeps a space between separate runs", async () => {
    // Generators often draw a word in pieces (kerning, a style change): one run ends where the next starts.
    const runs = `BT /F1 12 Tf 36 760 Td ${pdfString("Any dispute will be resolved by binding arbi")} Tj /F2 12 Tf ${pdfString("tration")} Tj /F1 12 Tf ${pdfString(" rather than in court.")} Tj ET`;
    const apart = `BT /F1 12 Tf 1 0 0 1 36 700 Tm ${pdfString("Words placed")} Tj ET BT /F1 12 Tf 1 0 0 1 300 700 Tm ${pdfString("apart.")} Tj ET`;
    const text = await extractPdf(pdfFromContent([`${runs}\n${apart}`]));
    expect(text).toContain("Any dispute will be resolved by binding arbitration rather than in court.");
    expect(text).toContain("Words placed apart.");
  });
  it("keeps headings in any language apart from the clause under them, and wrapped lines together", async () => {
    const clause = "Todas las controversias se resolveran mediante arbitraje vinculante conforme a este acuerdo.";
    const text = await extractPdf(makePdf([
      "Condiciones generales",
      "Este acuerdo regula el uso del servicio y de todas las funciones que le ofrecemos",
      "cada dia en cualquier pais donde el servicio se encuentre disponible para usted.",
      "Resolucion de disputas",
      clause,
    ].join("\n")));
    expect(text).toContain("Condiciones generales\n\n");
    expect(text).toContain("ofrecemos\ncada dia");
    expect(text).toContain(`para usted.\nResolucion de disputas\n\n${clause}`);
    const es = readDocument("terms", "https://service.example/terminos.pdf", text, "text/plain", compileRules(rulesFile as RulesFile), { language: "es" });
    expect(es.status).toBe("read");
    if (es.status === "read") expect(es.categories.find((c) => c.category === "arbitration")?.findings.map((f) => f.quote)).toEqual([clause]);
  });
  it("rejects corrupt and image-only PDFs instead of claiming a policy was checked", async () => {
    await expect(extractPdf(new TextEncoder().encode("%PDF-broken"))).rejects.toBeDefined();
    await expect(extractPdf(makePdf(""))).rejects.toThrow(/no extractable text/);
  });
  it("bounds page count before extracting a large document", async () => {
    await expect(extractPdf(makePdf("Policy", 101))).rejects.toThrow(/100 pages/);
  });
});
