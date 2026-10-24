import { describe, it, expect } from "vitest";
import rulesFile from "../rules/rules.json";
import { compileRules, type RulesFile } from "../src/engine/rules";
import { asAddress, fetchTargets, foundCount, freshPending, isOwnText, MAX_PASTED, readFetched, recordRecent, scanAddress, scanOrigins, scanPasted, scanTargets, scanText, scanUrl, PENDING_TTL_MS } from "../src/ui/scan";
import type { KnownSite } from "../src/engine/known-sites";
import type { DocumentResult } from "../src/engine/documents";

const rules = compileRules(rulesFile as RulesFile);
const filler = "This section explains how the service works and what each party agrees to under these terms in detail. ".repeat(30);
const terms = `Terms of Service. ${filler} Any dispute will be resolved by binding arbitration.`;
const page = (title: string) => `<html><body><h1>${title}</h1><p>${filler}</p><p>Any dispute will be resolved by binding arbitration.</p></body></html>`;

describe("Scan a link", () => {
  it("tells an address from pasted text", () => {
    expect(asAddress(" https://service.example/terms ")?.hostname).toBe("service.example");
    expect(asAddress("ftp://service.example/terms")).toBeNull();
    expect(asAddress("These terms of service say…")).toBeNull();
    expect(asAddress("https://service.example/terms and more")).toBeNull();
    // Never a local or private network address.
    for (const a of ["http://localhost/terms", "http://127.0.0.1/terms", "http://198.51.100.10/terms", "http://203.0.113.5/terms", "https://[::1]/terms", "https://nas.local/terms", "https://wiki.internal/terms", "http://router/terms"]) expect(asAddress(a), a).toBeNull();
  });

  it("reads pasted text on the device, with quotes", () => {
    const r = scanText(terms, "terms", rules);
    const d = r.documents[0]!;
    expect(d.status).toBe("read");
    if (d.status === "read") expect(d.categories.find((c) => c.category === "arbitration")?.status).toBe("found");
  });

  it("reads an address as the document it says it is, or says it is neither", async () => {
    const fetchOk = (html: string) => async (u: string) => ({ ok: true as const, url: u, text: html, contentType: "text/html" });
    const read = await scanUrl("https://www.service.example/terms", "auto", rules, fetchOk(page("Terms of Service")));
    expect(read.site).toBe("service.example");
    expect(read.documents.map((d) => [d.kind, d.status])).toEqual([["terms", "read"]]);
    const neither = await scanUrl("https://service.example/blog", "auto", rules, fetchOk(page("Our blog")));
    expect(neither.documents[0]!.status).toBe("could_not_read");
    const chosen = await scanUrl("https://service.example/legal", "terms", rules, fetchOk(page("Terms of Service")));
    expect(chosen.documents[0]!.status).toBe("read");
    const failed = await scanUrl("https://service.example/terms", "terms", rules, async () => ({ ok: false as const, reason: "The page answered 404." }));
    expect(failed.documents[0]).toMatchObject({ status: "could_not_read", reason: "The page answered 404." });
  });

  it("auto-detects a plain-text address by reading it", async () => {
    const plain = async (u: string) => ({ ok: true as const, url: u, text: terms, contentType: "text/plain" });
    const r = await scanUrl("https://service.example/terms.txt", "auto", rules, plain);
    expect(r.documents.map((d) => [d.kind, d.status])).toEqual([["terms", "read"]]);
  });

  it("reads at most 200,000 pasted characters, and says when it cut", () => {
    const long = `${terms} ${"x ".repeat(MAX_PASTED)}`;
    expect(scanPasted(long, "terms", rules).site).toBe("Pasted text (its first 200,000 characters)");
    expect(scanPasted(long.slice(0, MAX_PASTED), "terms", rules).site).toBe("Pasted text");
    expect(scanPasted(long, "auto", rules).documents[0]!.status).toBe("read");
    expect(isOwnText("Pasted text (its first 200,000 characters)")).toBe(true);
    expect(isOwnText("Selected text on service.example")).toBe(true);
    expect(isOwnText("service.example")).toBe(false);
  });

  it("reads pasted text as whichever document it says it is, or asks", () => {
    expect(scanPasted(terms, "auto", rules).documents.map((d) => [d.kind, d.status])).toEqual([["terms", "read"]]);
    expect(scanPasted(filler, "auto", rules).documents[0]).toMatchObject({ status: "could_not_read" });
    expect(scanPasted(terms, "privacy", rules).documents[0]).toMatchObject({ kind: "privacy", status: "could_not_read" });
  });

  const known: KnownSite[] = [{ id: "service", name: "Service", domains: ["service.example"], terms: "https://legal.service.example/terms", privacy: "https://policies.other.example/service-privacy" }];

  it("reads a known site's own documents for any of its addresses", async () => {
    expect(scanTargets("https://app.service.example/", "auto", known)).toEqual([
      { url: "https://legal.service.example/terms", kind: "terms" },
      { url: "https://policies.other.example/service-privacy", kind: "privacy" },
    ]);
    expect(scanTargets("https://service.example/", "privacy", known)).toEqual([{ url: "https://policies.other.example/service-privacy", kind: "privacy" }]);
    // One of its documents, or another site: the address itself.
    expect(scanTargets("https://legal.service.example/terms", "auto", known)).toEqual([{ url: "https://legal.service.example/terms", kind: "auto" }]);
    expect(scanTargets("https://else.example/terms", "auto", known)).toEqual([{ url: "https://else.example/terms", kind: "auto" }]);
    expect(scanOrigins("https://service.example/", "auto", known)).toEqual(["https://legal.service.example/*", "https://policies.other.example/*"]);
    const seen: string[] = [];
    const r = await scanAddress("https://service.example/", "auto", rules, known, async (u) => {
      seen.push(u);
      return { ok: true as const, url: u, text: page(u.endsWith("terms") ? "Terms of Service" : "Privacy Policy"), contentType: "text/html" };
    });
    expect(seen).toEqual(["https://legal.service.example/terms", "https://policies.other.example/service-privacy"]);
    expect(r.site).toBe("service.example");
    expect(r.documents.map((d) => [d.kind, d.status])).toEqual([["terms", "read"], ["privacy", "read"]]);
  });

  it("fetches in one place and reads in another, with the same result", async () => {
    const fetcher = async (u: string) => ({ ok: true as const, url: u, text: page(u.endsWith("terms") ? "Terms of Service" : "Privacy Policy"), contentType: "text/html" });
    const fetched = await fetchTargets("https://service.example/", "auto", known, fetcher);
    expect(fetched.documents).toEqual([]);
    expect(Object.keys(fetched.fetched!.pages)).toEqual(["https://legal.service.example/terms", "https://policies.other.example/service-privacy"]);
    const read = await readFetched(fetched, rules, known);
    const direct = await scanAddress("https://service.example/", "auto", rules, known, fetcher);
    expect(read.documents.map((d) => [d.kind, d.status])).toEqual(direct.documents.map((d) => [d.kind, d.status]));
    expect(read.fetched).toBeUndefined();
    // A result with nothing fetched is passed through.
    const plain = { site: "s.example", documents: [] };
    expect(await readFetched(plain, rules, known)).toBe(plain);
    // A page missing from what was fetched is reported, never invented.
    const missing = await readFetched({ ...fetched, fetched: { ...fetched.fetched!, pages: {} } }, rules, known);
    expect(missing.documents.every((d) => d.status === "could_not_read")).toBe(true);
  });

  it("keeps a pending scan only while fresh and well formed", () => {
    const now = 1_000_000_000;
    expect(freshPending({ url: "https://service.example/t", kind: "auto", at: now }, now)).not.toBeNull();
    expect(freshPending({ url: "https://service.example/t", kind: "auto", at: now - PENDING_TTL_MS - 1 }, now)).toBeNull();
    expect(freshPending({ url: "javascript:alert(1)", kind: "auto", at: now }, now)).toBeNull();
    expect(freshPending({ url: "https://service.example/t", kind: "other", at: now }, now)).toBeNull();
    expect(freshPending(undefined, now)).toBeNull();
    // The sites it asked for travel with it, and only as permission patterns.
    expect(freshPending({ url: "https://service.example/t", kind: "auto", at: now, origins: ["https://legal.service.example/*"] }, now)?.origins).toEqual(["https://legal.service.example/*"]);
    expect(freshPending({ url: "https://service.example/t", kind: "auto", at: now, origins: ["<all_urls>"] }, now)).toBeNull();
    expect(freshPending({ url: "https://service.example/t", kind: "auto", at: now, origins: "https://a.example/*" }, now)).toBeNull();
  });
});

describe("recently checked sites", () => {
  const read = (body: string): DocumentResult => ({ kind: "terms", status: "read", url: "https://service.example/terms", readAt: "t", categories: [], body });
  it("marks a document changed when its text differs from last time, newest first, at most ten", async () => {
    let list = await recordRecent([], "service.example", [read("version one")]);
    expect(list[0]!.changed).toEqual([]);
    list = await recordRecent(list, "service.example", [read("version one")]);
    expect(list[0]!.changed).toEqual([]);
    list = await recordRecent(list, "service.example", [read("version two")]);
    expect(list[0]!.changed).toEqual(["terms"]);
    // Not read this time: nothing new is claimed, the earlier change stays noted.
    list = await recordRecent(list, "service.example", [{ kind: "terms", status: "could_not_read", reason: "x" }]);
    expect(list[0]!.changed).toEqual(["terms"]);
    // The same text again soon after: still noted, for 30 days from the change.
    list = await recordRecent(list, "service.example", [read("version two")]);
    expect(list[0]!.changed).toEqual(["terms"]);
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    list = await recordRecent(list, "service.example", [read("version two")], later);
    expect(list[0]!.changed).toEqual([]);
    for (let i = 0; i < 12; i++) list = await recordRecent(list, `s${i}.example`, []);
    expect(list).toHaveLength(10);
    expect(list[0]!.site).toBe("s11.example");
  });

  it("keeps a change noted for exactly 30 days, and never fingerprints a report without its text", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    let list = await recordRecent([], "s.example", [read("one")], t0);
    list = await recordRecent(list, "s.example", [read("two")], t0);
    const day = 24 * 60 * 60 * 1000;
    expect((await recordRecent(list, "s.example", [], new Date(t0.getTime() + 30 * day - 1)))[0]!.changed).toEqual(["terms"]);
    expect((await recordRecent(list, "s.example", [], new Date(t0.getTime() + 30 * day)))[0]!.changed).toEqual([]);
    // A remembered report (quotes only, empty text) changes nothing.
    const kept = await recordRecent(list, "s.example", [read("")], t0);
    expect(kept[0]!.hashes).toEqual(list[0]!.hashes);
  });
});

describe("reading an address, edges", () => {
  it("names the document asked for when it could not be read", async () => {
    const failed = await scanUrl("https://service.example/p", "privacy", rules, async () => ({ ok: false as const, reason: "x" }));
    expect(failed.documents[0]!.kind).toBe("privacy");
  });
  it("reads a web page as the kind its heading names, not every kind it mentions", async () => {
    const html = `<html><head><title>Terms of Service</title></head><body><h1>Terms of Service</h1><p>${filler}</p><p>Our Privacy Policy explains how we use data.</p><p>Any dispute will be resolved by binding arbitration.</p></body></html>`;
    const r = await scanUrl("https://service.example/terms", "auto", rules, async (u) => ({ ok: true as const, url: u, text: html, contentType: "text/html; charset=utf-8" }));
    expect(r.documents.map((d) => d.kind)).toEqual(["terms"]);
  });
});

describe("found count for the site card and recent list", () => {
  const doc = (kind: "terms" | "privacy", found: string[], absent: string[] = []): DocumentResult => ({
    kind, status: "read", url: "https://service.example/terms", readAt: "2026-01-01T00:00:00Z", body: "x",
    categories: [...found.map((category) => ({ category, status: "found" as const, findings: [] })), ...absent.map((category) => ({ category, status: "not_found" as const, findings: [] }))],
  });
  it("counts each found topic once across documents, ignoring unread ones", async () => {
    expect(foundCount([doc("terms", ["ai_training", "arbitration"], ["data_sale"]), doc("privacy", ["ai_training"]), { kind: "privacy", status: "could_not_read", reason: "x" }])).toBe(2);
    expect(foundCount([doc("terms", [], ["data_sale"])])).toBe(0);
    const list = await recordRecent([], "service.example", [doc("terms", ["ai_training"])]);
    expect(list[0]!.found).toBe(1);
  });
});
