import { extractPdf } from "./pdf-text";
// Parsing is data-only. PDF documents cannot initiate network requests here.
globalThis.fetch = async () => { throw new Error("PDF network access is disabled."); };
self.onmessage = async (event: MessageEvent<Uint8Array>) => {
  try { self.postMessage({ ok: true, text: await extractPdf(event.data) }); }
  catch (err) { self.postMessage({ ok: false, reason: err instanceof Error ? err.message : "The PDF could not be read." }); }
};
