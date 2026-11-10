import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// Both modules are bundled locally. The core runs inside our dedicated worker;
// it does not load a second worker, remote scripts, fonts or document URLs.
// @ts-expect-error PDF.js publishes no declaration for the worker entry point.
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = { WorkerMessageHandler };

export async function extractPdf(data: Uint8Array): Promise<string> {
  const loading = getDocument({ data, useSystemFonts: false, useWorkerFetch: false, disableFontFace: true, enableXfa: false, disableAutoFetch: true, disableStream: true, stopAtErrors: true });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > 100) throw new Error("The PDF has more than 100 pages. Choose a shorter policy or paste its text.");
    const pages: string[] = [];
    let size = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        if (text && !/\s$/.test(text) && item.str && !/^\s/.test(item.str)) text += " ";
        text += item.str + (item.hasEOL ? "\n" : "");
      }
      size += text.length;
      if (size > 200_000) throw new Error("The PDF contains too much text to read. Choose a shorter policy or paste its text.");
      // Keep a short policy title separate from the first sentence. Ordinary
      // wrapped text remains joined by the plain-text reader.
      const lines = text.split("\n");
      if (lines[0] && lines[0].length <= 120 && !/[.!?]/.test(lines[0]) && /terms\s+(of|and|&)|privacy\s+(policy|notice|statement)|agreement/i.test(lines[0])) lines[0] += "\n";
      pages.push(lines.join("\n"));
      page.cleanup();
    }
    const text = pages.join("\n\n").trim();
    if (!text) throw new Error("This PDF has no extractable text. Image-only PDFs need OCR; paste an accessible text version instead.");
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === "PasswordException") throw new Error("This PDF requires a password. Open it yourself and paste the policy text.");
    throw err;
  } finally { await loading.destroy(); }
}
