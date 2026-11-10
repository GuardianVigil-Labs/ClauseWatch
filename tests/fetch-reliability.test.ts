import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOCKED_REASON, CANCELLED_REASON, FETCH_TIMEOUT_MS, fetchChosen, fetchText, MAX_BYTES, OFF_SITE_REASON, TIMEOUT_REASON } from "../src/auto/background";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const url = "https://service.example/terms";
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

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

describe("redirects checked before the next request", () => {
  it("never contacts off-site or private redirect destinations", async () => {
    for (const target of ["https://other.example/privacy", "http://192.0.2.10/admin", "file:///etc/passwd"]) {
      const fetcher = vi.fn().mockResolvedValue(redirect(target));
      vi.stubGlobal("fetch", fetcher);
      expect(await fetchChosen(url)).toEqual({ ok: false, reason: OFF_SITE_REASON });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("follows visible relative and known-site redirects after checking them", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(redirect("/legal/terms")).mockResolvedValueOnce(new Response("terms"));
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchChosen(url)).toMatchObject({ ok: true, url: "https://service.example/legal/terms", text: "terms" });
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([url, "https://service.example/legal/terms"]);
    const sites = [{ id: "service", name: "Service", domains: ["service.example"], legalDomains: ["parent.example"], terms: url, privacy: "https://parent.example/privacy" }];
    fetcher.mockReset().mockResolvedValueOnce(redirect("https://parent.example/terms")).mockResolvedValueOnce(new Response("terms"));
    expect(await fetchChosen(url, sites)).toMatchObject({ ok: true, url: "https://parent.example/terms" });
  });

  it("bounds redirect loops and refuses hidden or missing destinations", async () => {
    const fetcher = vi.fn().mockImplementation(async () => redirect(url));
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchChosen(url)).toMatchObject({ ok: false, reason: "The page redirected too many times." });
    expect(fetcher).toHaveBeenCalledTimes(6);
    fetcher.mockReset().mockResolvedValue({ type: "opaqueredirect" });
    expect(await fetchChosen(url)).toEqual({ ok: false, reason: BLOCKED_REASON });
    fetcher.mockReset().mockResolvedValue(new Response(null, { status: 302 }));
    expect(await fetchChosen(url)).toEqual({ ok: false, reason: BLOCKED_REASON });
  });
});
