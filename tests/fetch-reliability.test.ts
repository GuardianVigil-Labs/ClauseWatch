import { afterEach, describe, expect, it, vi } from "vitest";
import { CANCELLED_REASON, FETCH_TIMEOUT_MS, fetchChosen, fetchText, MAX_BYTES, MAX_PDF_BYTES, OFF_SITE_REASON, PDF_TOO_LARGE_REASON, TIMEOUT_REASON } from "../src/auto/background";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const url = "https://service.example/terms";

describe("bounded document downloads", () => {
  it("turns a dropped body stream into a document error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { c.error(new Error("dropped")); } }))));
    expect(await fetchText(url)).toMatchObject({ ok: false, reason: "The page could not be reached." });
  });

  it("times out both waiting for headers and stalled bodies", async () => {
    vi.useFakeTimers();
    for (const response of [undefined, new Response(new ReadableStream({ start() {} }))]) {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(() => response ? Promise.resolve(response) : new Promise(() => {})));
      const result = fetchText(url);
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - 1);
      let finished = false;
      void result.then(() => { finished = true; });
      await Promise.resolve();
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toEqual({ ok: false, reason: TIMEOUT_REASON });
    }
  });

  it("cancels without waiting for a fetch implementation to honour abort", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const result = fetchText(url, undefined, controller.signal);
    controller.abort();
    expect(await result).toEqual({ ok: false, reason: CANCELLED_REASON });
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(await fetchText(url, undefined, controller.signal)).toEqual({ ok: false, reason: CANCELLED_REASON });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("counts bytes, stops early, and cancels an oversized stream", async () => {
    let reads = 0;
    const cancelled = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({
      pull(c) { reads++; c.enqueue(new TextEncoder().encode("é".repeat(MAX_BYTES / 2))); },
      cancel: cancelled,
    }, { highWaterMark: 0 }))));
    expect(await fetchText(url)).toEqual({ ok: false, reason: "The page is too large to read." });
    expect(reads).toBe(2);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("refuses a PDF too large to keep in a scan, up front, and downloads one at the limit", async () => {
    const pdf = (size: number, headers: HeadersInit = {}) => {
      const body = new Uint8Array(size).fill(32);
      body.set(new TextEncoder().encode("%PDF-"));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers })));
    };
    pdf(MAX_PDF_BYTES + 1);
    expect(await fetchText(url)).toEqual({ ok: false, reason: PDF_TOO_LARGE_REASON });
    pdf(10, { "content-type": "application/pdf", "content-length": String(MAX_PDF_BYTES + 1) });
    expect(await fetchText(url)).toEqual({ ok: false, reason: PDF_TOO_LARGE_REASON });
    pdf(MAX_PDF_BYTES);
    expect(await fetchText(url)).toMatchObject({ ok: true, contentType: "application/pdf" });
  });

  it("decodes UTF-8 split across chunks and accepts an empty body", async () => {
    const bytes = new TextEncoder().encode("A😀éB");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); },
    }))));
    expect(await fetchText(url)).toMatchObject({ ok: true, text: "A😀éB" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
    expect(await fetchText(url)).toMatchObject({ ok: true, text: "" });
  });
});

describe("bounded PDF transport", () => {
  it("keeps declared PDF bytes intact without interpreting them as UTF-8", async () => {
    const data = new Uint8Array([37, 80, 68, 70, 45, 0, 255, 128, 10]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(data, { headers: { "content-type": "application/pdf" } })));
    const got = await fetchText(url);
    expect(got).toMatchObject({ ok: true, text: "", contentType: "application/pdf" });
    if (got.ok) expect(Uint8Array.from(atob(got.pdf!), (c) => c.charCodeAt(0))).toEqual(data);
  });
  it("recognises a PDF signature split across network chunks despite a generic MIME type", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 sample");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } }), { headers: { "content-type": "application/octet-stream" } })));
    expect(await fetchText(url)).toMatchObject({ ok: true, text: "", contentType: "application/pdf", pdf: btoa("%PDF-1.4 sample") });
  });
});

describe("redirects followed by the browser, final address checked", () => {
  // What a browser hands back after following redirects: the final answer, its
  // address and `redirected`. A manual redirect's Location is never visible.
  const followed = (finalUrl: string, body = "terms") => {
    const res = new Response(body);
    Object.defineProperty(res, "url", { value: finalUrl });
    Object.defineProperty(res, "redirected", { value: finalUrl !== url });
    return res;
  };

  it("asks the browser to follow redirects, without cookies", async () => {
    const fetcher = vi.fn().mockResolvedValue(followed(url));
    vi.stubGlobal("fetch", fetcher);
    await fetchChosen(url);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(url, { credentials: "omit", redirect: "follow", signal: expect.any(AbortSignal) });
  });

  it("reads a redirect that ended on the same site or the known site's legal domain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(followed("https://service.example/legal/terms")));
    expect(await fetchChosen(url)).toMatchObject({ ok: true, url: "https://service.example/legal/terms", text: "terms" });
    const sites = [{ id: "service", name: "Service", domains: ["service.example"], legalDomains: ["parent.example"], terms: url, privacy: "https://parent.example/privacy" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(followed("https://parent.example/terms")));
    expect(await fetchChosen(url, sites)).toMatchObject({ ok: true, url: "https://parent.example/terms" });
  });

  it("never reads a redirect that ended off the site, on a private address or with a hidden address", async () => {
    for (const target of ["https://other.example/privacy", "http://192.0.2.10/admin", "http://localhost/terms"]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(followed(target)));
      expect(await fetchChosen(url)).toEqual({ ok: false, reason: OFF_SITE_REASON });
    }
    const hidden = new Response("terms");
    Object.defineProperty(hidden, "redirected", { value: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(hidden));
    expect(await fetchChosen(url)).toEqual({ ok: false, reason: OFF_SITE_REASON });
  });
});
