/** Invented, text-only PDF fixture. Offsets are ASCII byte offsets, not a real company's document. */
export function makePdf(text: string, pages = 1): Uint8Array {
  const objects = ["", "<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids: string[] = [];
  for (let n = 0; n < pages; n++) {
    const page = objects.length;
    const stream = page + 1;
    kids.push(`${page} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R >>`);
    const lines = text.split("\n").map((line) => `(${line.replace(/[\\()]/g, (c) => `\\${c}`)}) Tj 0 -16 Td`).join("\n");
    const content = `BT /F1 12 Tf 36 760 Td\n${lines}\nET`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let n = 1; n < objects.length; n++) { offsets.push(pdf.length); pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
