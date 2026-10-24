import { describe, it, expect } from "vitest";
import sitesFile from "../rules/sites.json";
import rulesFile from "../rules/rules.json";
import { inPlaceKinds, isKnownDocument, isSignupPage, knownSite, onSiteDomains, sameDocument, SHARED_DOMAINS, siteOrigins, sitesProblem, MAX_SITES, type KnownSite } from "../src/engine/known-sites";
import { readSelection } from "../src/engine/documents";
import { compileRules, type RulesFile } from "../src/engine/rules";
import { BUNDLED } from "../src/engine/bundled";

// Known sites: popular services and the exact addresses of their documents.

const site = (over: Partial<KnownSite> = {}): KnownSite => ({
  id: "service",
  name: "Service",
  domains: ["service.example", "service-app.example"],
  terms: "https://legal.service.example/terms",
  privacy: "https://legal.service.example/privacy",
  signup: ["https://service.example/signup"],
  ...over,
});

describe("rules/sites.json", () => {
  it("is well formed and bundled with the rules", () => {
    expect(sitesProblem(sitesFile.sites)).toBeNull();
    expect(sitesFile.sites.length).toBeGreaterThan(0);
    expect(BUNDLED.sites).toEqual(sitesFile.sites);
    expect(Object.keys(sitesFile)).toEqual(["sites"]);
  });
});

describe("sitesProblem", () => {
  it("accepts a well-formed list", () => {
    expect(sitesProblem([site(), site({ id: "other", name: "Other", domains: ["other.example"], legalDomains: ["service.example"], signup: undefined })])).toBeNull();
    expect(sitesProblem([])).toBeNull();
  });

  it("refuses anything malformed", () => {
    const bad: unknown[] = [
      "not a list",
      [null],
      [site({ id: "Has Caps" })],
      [site({ id: "-dash" })],
      [site({ id: "x".repeat(41) })],
      [site(), site()], // the id twice
      [site(), site({ id: "other" })], // a domain twice
      [site({ name: "" })],
      [site({ name: "n".repeat(81) })],
      [site({ domains: [] })],
      [site({ domains: Array.from({ length: 11 }, (_, i) => `d${i}.example`) })],
      [site({ domains: ["www.service.example"] })],
      [site({ domains: ["Service.example"] })],
      [site({ domains: ["localhost"] })],
      [site({ terms: "http://legal.service.example/terms" })],
      [site({ terms: "https://legal.service.example/terms#top" })],
      [site({ terms: "https://user:pw@legal.service.example/terms" })],
      [site({ terms: "https://legal.service.example:8443/terms" })],
      [site({ terms: "https://legal.service.example" })], // not as the browser writes it (no "/")
      [site({ privacy: "https://legal.service.example/terms" })], // the same as terms
      [site({ signup: ["https://elsewhere.example/signup"] })],
      [site({ signup: ["https://service.example/signup?ref=1"] })],
      [site({ signup: Array.from({ length: 11 }, () => "https://service.example/signup") })],
      [{ ...site(), extra: true }],
      Array.from({ length: MAX_SITES + 1 }, (_, i) => site({ id: `s${i}`, domains: [`s${i}.example`] })),
    ];
    for (const b of bad) expect(sitesProblem(b), JSON.stringify(b).slice(0, 120)).not.toBeNull();
  });

  it("checks each field on its own, and each limit on both sides", () => {
    // Every other field well formed: one bad field is enough.
    expect(sitesProblem([site({ domains: "a.example" as never, signup: undefined })])).toMatch(/"domains" must list/);
    expect(sitesProblem([site({ domains: Array.from({ length: 11 }, (_, i) => `d${i}.example`), signup: undefined })])).toMatch(/"domains" must list/);
    expect(sitesProblem([site({ domains: [], signup: undefined })])).toMatch(/"domains" must list/);
    expect(sitesProblem([site({ domains: [5 as never] })])).toMatch(/not a lower-case public domain/);
    expect(sitesProblem([site({ domains: ["www.service.example"] })])).toMatch(/without "www."/);
    const label = (n: number) => "a".repeat(n);
    const long = `${label(63)}.${label(63)}.${label(63)}.${label(61)}`; // 253 characters
    expect(long.length).toBe(253);
    expect(sitesProblem([site({ domains: [long], legalDomains: ["service.example"], signup: undefined })])).toBeNull();
    expect(sitesProblem([site({ domains: [`a${long}`], signup: undefined })])).not.toBeNull();
    const path = (n: number) => `https://legal.service.example/${"t".repeat(n - "https://legal.service.example/".length)}`;
    expect(sitesProblem([site({ terms: path(500) })])).toBeNull();
    expect(sitesProblem([site({ terms: path(501) })])).toMatch(/terms/);
    expect(sitesProblem([site({ terms: 7 as never })])).toMatch(/terms/);
    expect(sitesProblem([site({ terms: "not a url" })])).toMatch(/terms/);
    expect(sitesProblem([site({ signup: Array.from({ length: 10 }, () => "https://service.example/signup") })])).toBeNull();
    expect(sitesProblem([site({ signup: "https://service.example/signup" as never })])).toMatch(/signup/);
  });

  it("keeps documents on the service's own domains or its listed legal domains, never a local address", () => {
    expect(sitesProblem([site({ terms: "https://legal.elsewhere.example/terms" })])).toMatch(/not on one of its domains or legalDomains/);
    expect(sitesProblem([site({ terms: "https://legal.elsewhere.example/terms", legalDomains: ["elsewhere.example"] })])).toBeNull();
    // A legal domain lets documents live there; it does not make the service known there.
    expect(knownSite([site({ legalDomains: ["elsewhere.example"] })], "elsewhere.example")).toBeNull();
    expect(sitesProblem([site({ privacy: "https://192.0.2.10/privacy" })])).not.toBeNull();
    for (const d of ["192.0.2.10", "intranet.corp", "nas.local", "router", "www.elsewhere.example", "Upper.example", "a.123"]) {
      expect(sitesProblem([site({ legalDomains: [d] })]), d).toMatch(/public domain/);
      expect(sitesProblem([site({ domains: [d], signup: undefined })]), d).not.toBeNull();
    }
    expect(sitesProblem([site({ legalDomains: "elsewhere.example" as never })])).toMatch(/legalDomains/);
    expect(sitesProblem([site({ legalDomains: Array.from({ length: 11 }, (_, i) => `l${i}.example`) })])).toMatch(/legalDomains/);
    expect(sitesProblem([site({ legalDomains: Array.from({ length: 10 }, (_, i) => `l${i}.example`) })])).toBeNull();
  });

  it("allows exactly the limits", () => {
    expect(sitesProblem([site({ id: "x".repeat(40), name: "n".repeat(80) })])).toBeNull();
    expect(sitesProblem([site({ domains: Array.from({ length: 10 }, (_, i) => `d${i}.example`), legalDomains: ["service.example"], signup: [] })])).toBeNull();
    expect(sitesProblem(Array.from({ length: MAX_SITES }, (_, i) => site({ id: `s${i}`, domains: [`s${i}.example`], legalDomains: ["service.example"], signup: undefined })))).toBeNull();
  });
});

describe("knownSite", () => {
  const sites = [site(), site({ id: "maps", name: "Maps", domains: ["maps.service.example"], signup: undefined })];
  it("matches a domain and its subdomains, the most specific first", () => {
    expect(knownSite(sites, "service.example")?.id).toBe("service");
    expect(knownSite(sites, "www.service.example")?.id).toBe("service");
    expect(knownSite(sites, "APP.Service-App.example.")?.id).toBe("service");
    expect(knownSite(sites, "maps.service.example")?.id).toBe("maps");
    expect(knownSite(sites, "eu.maps.service.example")?.id).toBe("maps");
    expect(knownSite(sites, "notservice.example")).toBeNull();
    expect(knownSite(sites, "service.example.evil.example")).toBeNull();
  });

  it("knows its sign-up pages and documents", () => {
    const s = site();
    expect(isSignupPage(s, "https://service.example/signup")).toBe(true);
    expect(isSignupPage(s, "https://service.example/signup?plan=free")).toBe(true);
    expect(isSignupPage(s, "https://service.example/signup/step-2")).toBe(true);
    expect(isSignupPage(s, "https://service.example/signups-closed")).toBe(false);
    expect(isSignupPage(s, "https://service.example/")).toBe(false);
    expect(isSignupPage(site({ signup: undefined }), "https://service.example/signup")).toBe(false);
    expect(isSignupPage(s, "not a url")).toBe(false);
    expect(isSignupPage(site({ signup: ["not a url"] }), "https://service.example/signup")).toBe(false);
    // "www." on either side does not matter; the path keeps its case.
    expect(isSignupPage(s, "https://www.service.example/signup")).toBe(true);
    expect(isSignupPage(site({ signup: ["https://www.service.example/signup"] }), "https://service.example/signup/next")).toBe(true);
    expect(isSignupPage(s, "https://service.example/SignUp")).toBe(false);
    expect(isSignupPage(s, "https://app.service.example/signup")).toBe(false);
    expect(isSignupPage(s, "http://service.example/signup")).toBe(false);
    expect(isKnownDocument(s, "https://legal.service.example/terms")).toBe(true);
    expect(isKnownDocument(s, "https://legal.service.example/privacy")).toBe(true);
    expect(isKnownDocument(s, "https://legal.service.example/other")).toBe(false);
    expect(isKnownDocument(null, "https://legal.service.example/terms")).toBe(false);
  });
});

describe("readSelection (the right-click menu)", () => {
  const rules = compileRules(rulesFile as RulesFile);
  it("quotes a selected clause without asking for a whole document", () => {
    const d = readSelection("Any dispute will be resolved by binding arbitration on an individual basis.", "https://service.example/terms", rules);
    expect(d.status).toBe("read");
    if (d.status === "read") expect(d.categories.find((c) => c.category === "arbitration")?.findings[0]?.quote).toContain("binding arbitration");
  });
  it("asks for more than a few words", () => {
    expect(readSelection("binding arbitration", "", rules)).toMatchObject({ status: "could_not_read" });
    // Exactly the minimum quote length is enough.
    const words = Array.from({ length: rules.minQuoteWords }, (_, i) => `word${i}`).join(" ");
    expect(readSelection(words, "", rules).status).toBe("read");
    expect(readSelection(words.split(" ").slice(1).join(" "), "", rules).status).toBe("could_not_read");
  });
});

describe("a known site's listed documents", () => {
  const s = site({ domains: ["service.example", "service-app.example"], legalDomains: ["parent.example"], privacy: "https://www.parent.example/privacy/statement/" });

  it("matches its document address ignoring the fragment, a trailing slash and www.", () => {
    expect(sameDocument("https://www.parent.example/privacy/statement/", "https://parent.example/privacy/statement#cookies")).toBe(true);
    expect(sameDocument("https://parent.example/privacy", "https://parent.example/privacy/")).toBe(true);
    expect(sameDocument("https://parent.example/privacy", "https://parent.example/privacy/other")).toBe(false);
    // A query on the same page, a tracking tag say, is the same document.
    expect(sameDocument("https://parent.example/privacy", "https://parent.example/privacy?lang=fr")).toBe(true);
    expect(sameDocument("https://parent.example/privacy", "http://parent.example/privacy")).toBe(false);
    expect(sameDocument("https://parent.example/privacy", "https://legal.parent.example/privacy")).toBe(false);
    expect(sameDocument("not a url", "https://parent.example/privacy")).toBe(false);
    expect(sameDocument("https://parent.example/privacy", "not a url")).toBe(false);
    expect(isKnownDocument(s, "https://parent.example/privacy/statement")).toBe(true);
    expect(isKnownDocument(s, "https://legal.service.example/terms/#top")).toBe(true);
  });

  it("reads a known site's page in place only when it is that listed document", () => {
    // A sign-up page that mentions the privacy statement is not read as it.
    expect(inPlaceKinds(["privacy"], s, "https://login.service.example/signup/")).toEqual([]);
    expect(inPlaceKinds(["terms", "privacy"], s, "https://legal.service.example/terms#section-2")).toEqual(["terms"]);
    expect(inPlaceKinds(["terms", "privacy"], s, "https://parent.example/privacy/statement")).toEqual(["privacy"]);
    expect(inPlaceKinds(["terms"], s, "https://legal.service.example/terms?utm_source=mail")).toEqual(["terms"]);
    // An unknown site: what the page says it is.
    expect(inPlaceKinds(["terms", "privacy"], null, "https://else.example/signup")).toEqual(["terms", "privacy"]);
  });

  it("asks for, and follows redirects across, all of its domains and legal domains only", () => {
    expect(siteOrigins(s)).toEqual([
      "https://service.example/*", "https://*.service.example/*",
      "https://service-app.example/*", "https://*.service-app.example/*",
      "https://parent.example/*", "https://*.parent.example/*",
    ]);
    expect(siteOrigins(site({ domains: ["service.example"] }))).toEqual(["https://service.example/*", "https://*.service.example/*"]);
    expect(onSiteDomains(s, "WWW.Service-App.example.")).toBe(true);
    expect(onSiteDomains(s, "parent.example")).toBe(true);
    expect(onSiteDomains(s, "notparent.example")).toBe(false);
    expect(onSiteDomains(s, "parent.example.evil.example")).toBe(false);
  });
});

describe("shared domains", () => {
  it("refuses a public suffix or shared host as a domain or legal domain", () => {
    for (const d of ["co.uk", "com.au", "co.jp", "github.io", "pages.dev", "vercel.app", "netlify.app", "notion.site", "herokuapp.com", "blogspot.com", "appspot.com", "web.app", "firebaseapp.com", "azurewebsites.net", "cloudfront.net", "s3.amazonaws.com"]) {
      expect(SHARED_DOMAINS.has(d)).toBe(true);
      expect(sitesProblem([site({ domains: [d], terms: `https://${d}/terms`, privacy: `https://${d}/privacy` })])).toMatch(/is not a lower-case public domain/);
      expect(sitesProblem([site({ legalDomains: [d] })])).toMatch(/is not a lower-case public domain/);
    }
    // A service's own name under one of them is its own.
    expect(sitesProblem([site({ domains: ["service.github.io"], terms: "https://service.github.io/terms", privacy: "https://service.github.io/privacy", signup: undefined })])).toBeNull();
  });
});
