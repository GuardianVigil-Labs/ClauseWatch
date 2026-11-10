import type { Fetched } from "../auto/background";

/** PDF bytes stay on this device and are parsed in a disposable, bounded worker. */
export async function readableFetched(got: Fetched): Promise<Fetched> {
  if (!got.ok || !got.pdf) return got;
  if (!/^(chrome|moz)-extension:$/.test(location.protocol)) return { ok: false, reason: "This policy is a PDF. Open ClauseWatch and scan its link to read it on this device." };
  const data = Uint8Array.from(atob(got.pdf), (c) => c.charCodeAt(0));
  return new Promise((resolve) => {
    let worker: Worker;
    try { worker = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" }); }
    catch { resolve({ ok: false, reason: "The browser could not start the PDF reader. Open the PDF and paste its text." }); return; }
    const finish = (result: Fetched) => { clearTimeout(timer); worker.terminate(); resolve(result); };
    const timer = setTimeout(() => finish({ ok: false, reason: "The PDF took too long to read. Try a shorter policy or paste its text." }), 15_000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; text?: string; reason?: string }>) => {
      if (typeof event.data?.ok !== "boolean") return;
      finish(event.data.ok ? { ok: true, url: got.url, contentType: "text/plain", text: event.data.text ?? "" } : { ok: false, reason: event.data.reason ?? "The PDF could not be read." });
    };
    worker.onerror = () => finish({ ok: false, reason: "The PDF could not be read. Open it in a tab and paste its text." });
    worker.postMessage(data, [data.buffer]);
  });
}
