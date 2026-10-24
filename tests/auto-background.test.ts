import { describe, it, expect, vi } from "vitest";
import { cachedDocs, docsStale, mayFetch, readKey, rememberDocs, rememberIfCurrent } from "../src/auto/background";
import rulesFile from "../rules/rules.json";
import { compileRules, type RulesFile } from "../src/engine/rules";
import { loadRules } from "../src/engine/rule-set";
import { readDocument } from "../src/engine/documents";
import type { KV } from "../src/storage";
import type { DocumentResult } from "../src/engine/documents";

describe("mayFetch", () => {
  it("allows the page's own site only, over http(s)", () => {
    expect(mayFetch("https://service.example/terms", "https://www.service.example/signup")).toBe(true);
    expect(mayFetch("https://legal.service.example/privacy", "https://service.example/")).toBe(true);
    expect(mayFetch("https://other.example/terms", "https://service.example/")).toBe(false);
    expect(mayFetch("file:///etc/passwd", "https://service.example/")).toBe(false);
    expect(mayFetch("http://192.0.2.10/latest", "https://service.example/")).toBe(false);
    // No local addresses, even when they look like the same "site".
    expect(mayFetch("http://192.0.2.1/terms", "http://198.51.100.1/")).toBe(false);
    expect(mayFetch("http://[::1]/terms", "http://[::1]/")).toBe(false);
    expect(mayFetch("http://router/terms", "http://router/")).toBe(false);
    expect(mayFetch("https://intranet.corp/terms", "https://www.intranet.corp/")).toBe(false);
    expect(mayFetch("https://nas.local/terms", "https://nas.local/")).toBe(false);
    expect(mayFetch("https://service.example/terms", undefined)).toBe(false);
    expect(mayFetch("not a url", "https://service.example/")).toBe(false);
  });
});

describe("document cache", () => {
  const mem = new Map<string, unknown>();
  const kv: KV = { get: async (k) => mem.get(k), set: async (k, v) => void mem.set(k, v), remove: async (k) => void mem.delete(k) };
  const doc: DocumentResult = { kind: "terms", status: "read", url: "https://s.example/terms", readAt: "2026-10-14T00:00:00Z", categories: [], body: "the whole long text" };
  it("remembers a site's documents for a week, without their full text", async () => {
    await rememberDocs(kv, "s.example", [doc], 1000);
    const got = await cachedDocs(kv, "s.example", 2000);
    expect(got).toHaveLength(1);
    expect(got![0]).toMatchObject({ status: "read", body: "" });
    expect(await cachedDocs(kv, "s.example", 1000 + 7 * 864e5 + 1)).toBeNull();
    expect(await cachedDocs(kv, "other.example", 2000)).toBeNull();
  });
  it("does not reuse documents read before the person's rules changed", async () => {
    const store = new Map<string, unknown>();
    const k: KV = { get: async (x) => store.get(x), set: async (x, v) => void store.set(x, v), remove: async (x) => void store.delete(x) };
    const base = compileRules(rulesFile as RulesFile);
    const filler = "<p>This section explains how the service works and what each party agrees to under these terms in detail.</p>".repeat(30);
    const html = `<h1>Terms of Service</h1>${filler}<p>We may use the content you upload to train our machine learning models and improve them.</p>`;
    const read = async () => [readDocument("terms", "https://s.example/terms", html, "text/html", await loadRules(k, base))];
    // The person switched the AI training rule off; the documents are read and remembered.
    await k.set("disabledRuleIds", ["ai-training-on-user-content"]);
    await rememberDocs(k, "s.example", await read(), 1000, await readKey(k));
    // Then they switch it back on: the remembered read no longer counts.
    await k.set("disabledRuleIds", []);
    expect(docsStale({ disabledRuleIds: {} })).toBe(true);
    expect(await cachedDocs(k, "s.example", 3000, await readKey(k))).toBeNull();
    const fresh = await read();
    expect(fresh[0]!.status === "read" && fresh[0]!.categories.some((c) => c.category === "ai_training" && c.status === "found")).toBe(true);
  });

  it("forgets remembered documents when the rules change, not otherwise", () => {
    expect(docsStale({ disabledRuleIds: {} })).toBe(true);
    expect(docsStale({ ownRules: {} })).toBe(true);
    expect(docsStale({ automatic: {} })).toBe(false);
    expect(docsStale({ mutedSites: {} })).toBe(false);
    // A new signed rules release.
    expect(docsStale({ "rules:update": { oldValue: undefined, newValue: { signature: "s" } } })).toBe(true);
  });

  it("keys remembered documents on the rules release too, and keeps them for exactly a week", async () => {
    const store = new Map<string, unknown>();
    const k: KV = { get: async (x) => store.get(x), set: async (x, v) => void store.set(x, v), remove: async (x) => void store.delete(x) };
    // An extension update reads every site afresh.
    expect(await readKey(k, "1.0.0")).not.toBe(await readKey(k, "1.0.1"));
    const before = await readKey(k);
    await k.set("rules:update", { signature: "release-2" });
    expect(await readKey(k)).not.toBe(before);
    await rememberDocs(k, "s.example", [], 1000, "key");
    expect(await cachedDocs(k, "s.example", 1000 + 7 * 864e5 - 1, "key")).toEqual([]);
    expect(await cachedDocs(k, "s.example", 1000 + 7 * 864e5, "key")).toBeNull();
    expect(await cachedDocs(k, "s.example", 2000, "other")).toBeNull();
    // A read that finished after the rules changed is not kept.
    expect(await rememberIfCurrent(k, "late.example", [], "old", "new", 1000)).toBe(false);
    expect(store.has("docs:late.example")).toBe(false);
    expect(await rememberIfCurrent(k, "late.example", [], "same", "same", 1000)).toBe(true);
    expect(await cachedDocs(k, "late.example", 2000, "same")).toEqual([]);
  });
});


describe("fetchText off-site redirects", () => {
  it("discards a read that ended on another site", async () => {
    const { fetchText, mayFetch, OFF_SITE_REASON } = await import("../src/auto/background");
    const res = new Response("<html>terms</html>", { status: 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(res, "url", { value: "http://192.0.2.10/admin" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
    const got = await fetchText("https://service.example/terms", (end) => mayFetch(end, "https://app.service.example/signup"));
    expect(got).toEqual({ ok: false, reason: OFF_SITE_REASON });
    vi.unstubAllGlobals();
  });
});

describe("fetchText, every refusal and the limits", () => {
  const MAX = 2 * 1024 * 1024;
  const respond = (body: string, init: ResponseInit = {}, url = "") => {
    const res = new Response(body, { status: 200, headers: { "content-type": "text/html" }, ...init });
    Object.defineProperty(res, "url", { value: url });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
  };
  it("says why it could not read, and never claims a read", async () => {
    const { fetchText } = await import("../src/auto/background");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await fetchText("https://service.example/terms")).toEqual({ ok: false, reason: "The page could not be reached." });
    respond("gone", { status: 404 });
    expect(await fetchText("https://service.example/terms")).toEqual({ ok: false, reason: "The page answered 404." });
    respond("x", { headers: { "content-length": String(MAX + 1) } });
    expect(await fetchText("https://service.example/terms")).toEqual({ ok: false, reason: "The page is too large to read." });
    respond("x".repeat(MAX + 1));
    expect(await fetchText("https://service.example/terms")).toEqual({ ok: false, reason: "The page is too large to read." });
    vi.unstubAllGlobals();
  });
  it("reads exactly the limit, and keeps the address it was asked for when the answer names none", async () => {
    const { fetchText } = await import("../src/auto/background");
    respond("x".repeat(MAX), { headers: { "content-type": "text/html", "content-length": String(MAX) } });
    const got = await fetchText("https://service.example/terms", () => false);
    expect(got).toMatchObject({ ok: true, url: "https://service.example/terms", contentType: "text/html" });
    respond("terms", {}, "https://legal.service.example/terms");
    expect(await fetchText("https://service.example/terms")).toMatchObject({ ok: true, url: "https://legal.service.example/terms" });
    vi.unstubAllGlobals();
  });
  it("reads a chosen address only off the local network, and only if it stays on its site", async () => {
    const { fetchChosen, LOCAL_REASON, OFF_SITE_REASON } = await import("../src/auto/background");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchChosen("http://198.51.100.10/terms")).toEqual({ ok: false, reason: LOCAL_REASON });
    expect(await fetchChosen("http://localhost:8080/terms")).toEqual({ ok: false, reason: LOCAL_REASON });
    expect(fetchMock).not.toHaveBeenCalled();
    respond("terms", {}, "https://other.example/terms");
    expect(await fetchChosen("https://service.example/terms")).toEqual({ ok: false, reason: OFF_SITE_REASON });
    respond("terms", {}, "http://203.0.113.1/terms");
    expect(await fetchChosen("https://service.example/terms")).toEqual({ ok: false, reason: OFF_SITE_REASON });
    respond("terms", {}, "https://legal.service.example/terms");
    expect(await fetchChosen("https://service.example/terms")).toMatchObject({ ok: true, url: "https://legal.service.example/terms" });
    vi.unstubAllGlobals();
  });

  it("refuses literal and local addresses", async () => {
    const { localHost } = await import("../src/auto/background");
    expect(localHost("[2001:db8::1]")).toBe(true);
    expect(localHost("203.0.113.7")).toBe(true);
    expect(localHost("service.example")).toBe(false);
  });
});

describe("redirects within a known site", () => {
  const sites = [{ id: "service", name: "Service", domains: ["service.example", "service-app.example"], legalDomains: ["parent.example"], terms: "https://www.service.example/terms", privacy: "https://parent.example/privacy" }];
  const respond = (url: string) => {
    const res = new Response("terms", { status: 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(res, "url", { value: url });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
  };

  it("allows hops between its own domains and legal domains, never elsewhere", async () => {
    const { withinKnownSite } = await import("../src/auto/background");
    expect(withinKnownSite("https://service-app.example/sync?next=1", "https://www.service.example/terms", sites)).toBe(true);
    expect(withinKnownSite("https://www.parent.example/privacy", "https://service.example/privacy", sites)).toBe(true);
    expect(withinKnownSite("https://other.example/terms", "https://www.service.example/terms", sites)).toBe(false);
    expect(withinKnownSite("https://service-app.example/", "https://other.example/terms", sites)).toBe(false);
    expect(withinKnownSite("http://192.0.2.10/terms", "https://www.service.example/terms", sites)).toBe(false);
    expect(withinKnownSite("https://intranet.service.local/", "https://www.service.example/terms", sites)).toBe(false);
    expect(withinKnownSite("file:///etc/passwd", "https://www.service.example/terms", sites)).toBe(false);
    expect(withinKnownSite("https://service-app.example/", "not a url", sites)).toBe(false);
    expect(withinKnownSite("https://service-app.example/", "https://www.service.example/terms", [])).toBe(false);
    // From one known site's domain to another known site's: refused.
    const two = [...sites, { id: "other", name: "Other", domains: ["other-service.example"], terms: "https://other-service.example/terms", privacy: "https://other-service.example/privacy" }];
    expect(withinKnownSite("https://other-service.example/terms", "https://www.service.example/terms", two)).toBe(false);
    expect(withinKnownSite("https://www.service.example/terms", "https://other-service.example/terms", two)).toBe(false);
  });

  it("follows such a redirect for a chosen address, and refuses one off the site", async () => {
    const { fetchChosen, OFF_SITE_REASON } = await import("../src/auto/background");
    respond("https://www.service.example/terms");
    expect(await fetchChosen("https://www.service.example/terms", sites)).toMatchObject({ ok: true });
    respond("https://service-app.example/terms");
    expect(await fetchChosen("https://www.service.example/terms", sites)).toMatchObject({ ok: true, url: "https://service-app.example/terms" });
    // Without the known sites, the same hop is another site.
    expect(await fetchChosen("https://www.service.example/terms")).toEqual({ ok: false, reason: OFF_SITE_REASON });
    respond("https://other.example/terms");
    expect(await fetchChosen("https://www.service.example/terms", sites)).toEqual({ ok: false, reason: OFF_SITE_REASON });
    vi.unstubAllGlobals();
  });

  it("says a redirect was blocked when the browser would not follow it", async () => {
    const { fetchText, BLOCKED_REASON } = await import("../src/auto/background");
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("NetworkError")).mockResolvedValueOnce({ type: "opaqueredirect", status: 0 });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchText("https://www.service.example/terms")).toEqual({ ok: false, reason: BLOCKED_REASON });
    expect(fetchMock).toHaveBeenLastCalledWith("https://www.service.example/terms", { credentials: "omit", redirect: "manual" });
    for (const status of [300, 302, 399]) {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("NetworkError")).mockResolvedValueOnce({ type: "basic", status }));
      expect(await fetchText("https://www.service.example/terms")).toEqual({ ok: false, reason: BLOCKED_REASON });
    }
    for (const status of [200, 299, 400]) {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("NetworkError")).mockResolvedValueOnce({ type: "basic", status }));
      expect(await fetchText("https://www.service.example/terms")).toEqual({ ok: false, reason: "The page could not be reached." });
    }
    vi.unstubAllGlobals();
  });
});

describe("automatic mode's fetches for a page (pageFetch)", () => {
  const sites = [{ id: "service", name: "Service", domains: ["service.example", "service-app.example"], legalDomains: ["parent.example"], terms: "https://www.service.example/terms", privacy: "https://www.parent.example/privacy" }];
  const respond = (url: string) => {
    const res = new Response("<html>doc</html>", { status: 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(res, "url", { value: url });
    const f = vi.fn().mockResolvedValue(res);
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("fetches the page's own site and its known site's listed documents, nothing else", async () => {
    const { pageFetch } = await import("../src/auto/background");
    const tab = "https://app.service.example/signup";
    respond("https://www.service.example/legal/terms");
    expect(await pageFetch("https://www.service.example/legal/terms", tab, sites)).toMatchObject({ ok: true });
    // The listed privacy statement, on the parent's legal domain, with a redirect within it.
    respond("https://legal.parent.example/privacy");
    expect(await pageFetch("https://www.parent.example/privacy", tab, sites)).toMatchObject({ ok: true, url: "https://legal.parent.example/privacy" });
    // A redirect between the known site's own domains.
    respond("https://service-app.example/terms");
    expect(await pageFetch("https://www.service.example/terms", tab, sites)).toMatchObject({ ok: true });
    // Another address on the legal domain is not listed: refused before any fetch.
    const f = respond("https://www.parent.example/other");
    expect(await pageFetch("https://www.parent.example/other", tab, sites)).toEqual({ ok: false, reason: "Not on this site." });
    expect(await pageFetch("https://elsewhere.example/terms", tab, sites)).toEqual({ ok: false, reason: "Not on this site." });
    expect(await pageFetch("http://192.0.2.1/terms", tab, sites)).toEqual({ ok: false, reason: "Not on this site." });
    expect(await pageFetch("https://www.service.example/terms", undefined, sites)).toEqual({ ok: false, reason: "Not on this site." });
    expect(await pageFetch("https://www.service.example/terms", "not a url", sites)).toEqual({ ok: false, reason: "Not on this site." });
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("refuses a read that redirected off the site or to a private address", async () => {
    const { pageFetch, OFF_SITE_REASON } = await import("../src/auto/background");
    const tab = "https://app.service.example/signup";
    respond("http://192.0.2.10/admin");
    expect(await pageFetch("https://www.parent.example/privacy", tab, sites)).toEqual({ ok: false, reason: OFF_SITE_REASON });
    respond("https://elsewhere.example/terms");
    expect(await pageFetch("https://www.service.example/terms", tab, sites)).toEqual({ ok: false, reason: OFF_SITE_REASON });
    // On an unknown site, only its own site.
    respond("https://other.example/terms");
    expect(await pageFetch("https://unknown.example/terms", "https://unknown.example/signup", sites)).toEqual({ ok: false, reason: OFF_SITE_REASON });
    respond("https://legal.unknown.example/terms");
    expect(await pageFetch("https://unknown.example/terms", "https://unknown.example/signup", sites)).toMatchObject({ ok: true });
    vi.unstubAllGlobals();
  });
});
