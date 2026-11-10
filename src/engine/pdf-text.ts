import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// Both modules are bundled locally. The core runs inside our dedicated worker;
// it does not load a second worker, remote scripts, fonts or document URLs.
// @ts-expect-error PDF.js publishes no declaration for the worker entry point.
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = { WorkerMessageHandler };

// PDF.js 6 has no eval path (its isEvalSupported option was removed), and the
// Function("return this") fallback in the legacy build's bundled core-js is
// replaced with globalThis at build time (wxt.config.ts). The modern build is
// not used: it calls Map.prototype.getOrInsertComputed and Math.sumPrecise
// unconditionally, which the oldest supported browsers lack.
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
      let last: { end: number; y: number } | null = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        if (item.str) {
          const [, , c, d, x, y] = item.transform as number[];
          const em = Math.hypot(c!, d!) || 1;
          // A run that starts where the previous one ended on the same line
          // (kerned or restyled glyphs) continues the same word; a gap is a space.
          const continues = last && Math.abs(y! - last.y) < em / 2 && Math.abs(x! - last.end) < em * 0.15;
          if (text && !continues && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
          text += item.str;
          last = { end: x! + item.width, y: y! };
        }
        if (item.hasEOL) { text += "\n"; last = null; }
      }
      size += text.length;
      if (size > 200_000) throw new Error("The PDF contains too much text to read. Choose a shorter policy or paste its text.");
      const lines = text.split("\n");
      // A heading (a short line without closing punctuation, after a sentence
      // ends) is kept apart from the clause under it, in any language.
      // Ordinary wrapped lines stay joined by the plain-text reader.
      const widest = Math.max(...lines.map((l) => l.trim().length));
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i]!.trim();
        const before = i === 0 ? "" : lines[i - 1]!.trim();
        if (line && line.length <= 120 && line.length < widest * 0.7 && !/[.!?:;,]$/.test(line) && (!before || /[.!?:]$/.test(before)) && lines[i + 1]!.trim()) lines[i] += "\n";
      }
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
