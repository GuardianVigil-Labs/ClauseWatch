/** Invented, text-only PDF fixtures. Offsets are ASCII byte offsets, not a real company's document. */

/** A PDF whose pages draw these raw content streams, with Helvetica as /F1 and Helvetica-Bold as /F2. */
export function pdfFromContent(contents: string[]): Uint8Array {
  const objects = ["", "<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
  const kids: string[] = [];
  for (const content of contents) {
    const page = objects.length;
    const stream = page + 1;
    kids.push(`${page} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${stream} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${contents.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let n = 1; n < objects.length; n++) { offsets.push(pdf.length); pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export const pdfString = (s: string) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;

/** One line of text per `\n`, each drawn as a single run, on every page. */
export function makePdf(text: string, pages = 1): Uint8Array {
  const lines = text.split("\n").map((line) => `${pdfString(line)} Tj 0 -16 Td`).join("\n");
  return pdfFromContent(Array.from({ length: pages }, () => `BT /F1 12 Tf 36 760 Td\n${lines}\nET`));
}
