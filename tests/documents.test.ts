import { describe, it, expect } from "vitest";
import rulesFile from "../rules/rules.json";
import { compileRules, type RulesFile } from "../src/engine/rules";
import { discoverLinks, kindsOfPage, readDocument, sameSite } from "../src/engine/documents";

const rules = compileRules(rulesFile as RulesFile);
const filler = "<p>This section explains how the service works and what each party agrees to under these terms in detail.</p>".repeat(30);
const page = (title: string, extra = "") => `<html><body><h1>${title}</h1>${filler}<p>${extra}</p></body></html>`;

describe("finding and reading documents", () => {
  it("prefers a link that names the document, drops fragments and other sites", () => {
    const html = `<a href="/ai-whitepaper">AI and privacy</a> <a href="/legal/ps#eu">Privacy Statement</a>
      <a href="https://other.example/terms">Terms</a> <a href="/legal/terms-of-service">Legal</a>`;
    const links = discoverLinks(html, "https://www.example.com/signup");
    expect(links.privacy).toEqual(["https://www.example.com/legal/ps", "https://www.example.com/ai-whitepaper"]);
    expect(links.terms).toEqual(["https://www.example.com/legal/terms-of-service"]);
  });

  it("finds no links on, or to, a local or private network address", () => {
    const html = `<a href="/terms">Terms of Service</a> <a href="/privacy">Privacy Policy</a>`;
    for (const page of ["http://198.51.100.10/signup", "http://localhost/signup", "https://wiki.corp.internal/signup", "https://nas.local/signup"]) {
      expect(discoverLinks(html, page), page).toEqual({ terms: [], privacy: [] });
    }
    expect(discoverLinks(html, "https://www.example.com/signup").terms).toEqual(["https://www.example.com/terms"]);
  });

  it("treats subdomains as the same site", () => {
    expect(sameSite("docs.example.com", "www.example.com")).toBe(true);
    expect(sameSite("example.com.evil.test", "example.com")).toBe(false);
  });

  it("reads a document that names itself, with quotes", () => {
    const r = readDocument("terms", "https://example.com/terms", page("Terms of Service", "Any dispute will be resolved by binding arbitration."), "text/html; charset=utf-8", rules);
    expect(r.status).toBe("read");
    if (r.status === "read") expect(r.categories.find((c) => c.category === "arbitration")?.findings[0]?.quote).toBe("Any dispute will be resolved by binding arbitration.");
  });

  it.each([
    ["a page that never calls itself the document", page("AI Whitepaper", "We may use your content to train our models."), "text/html"],
    ["a sign-in wall", "<p>Please sign in to continue.</p>", "text/html"],
    ["a PDF", "%PDF-1.7", "application/pdf"],
  ])("says it could not read %s, never 'not found'", (_label, content, type) => {
    const r = readDocument("privacy", "https://example.com/x", content, type, rules);
    expect(r.status).toBe("could_not_read");
    if (r.status === "could_not_read") expect(r.reason.length).toBeGreaterThan(10);
  });

  it("knows when the current page is itself a document", () => {
    expect(kindsOfPage(page("Privacy Policy"))).toEqual(["privacy"]);
    expect(kindsOfPage("<p>Sign up for our service today.</p>")).toEqual([]);
  });

  it("reads a terms page that mentions the privacy policy as terms only", () => {
    const terms = page("Terms of Service", "Our Privacy Statement explains how we use your data.");
    expect(kindsOfPage(terms)).toEqual(["terms"]);
    expect(kindsOfPage(`<html><head><title>Privacy Notice | Service</title></head><body>${filler}<p>This Privacy Notice and our Terms of Use apply.</p></body></html>`)).toEqual(["privacy"]);
    // A page that names both in its heading is both; one that names neither keeps what its text says.
    expect(kindsOfPage(page("Terms of Service and Privacy Policy"))).toEqual(["terms", "privacy"]);
    expect(kindsOfPage(page("Legal", "Read the Terms of Use and the Privacy Policy."))).toEqual(["terms", "privacy"]);
    // Entities are decoded, and an SVG's <title> is not the page's.
    expect(kindsOfPage(`<html><head><title>Terms &amp; Conditions</title></head><body>${filler}<p>These Terms &amp; Conditions and our Privacy Policy apply.</p></body></html>`)).toEqual(["terms"]);
    expect(kindsOfPage(`<html><body><svg><title>Privacy Policy</title></svg><h1>Terms of Use</h1>${filler}<p>See the Privacy Policy.</p></body></html>`)).toEqual(["terms"]);
    // Markup inside the heading, and attributes on the title, do not hide its name.
    expect(kindsOfPage(page('Terms <b class="x">of</b> Service', "Our Privacy Policy explains the rest.").replace("<h1>", '<h1 class="title">'))).toEqual(["terms"]);
    expect(kindsOfPage(`<html><head><title data-x="a=b">Service = Privacy Policy</title></head><body>${filler}<p>This Privacy Policy and our Terms of Use apply.</p></body></html>`)).toEqual(["privacy"]);
  });
});

describe("same site", () => {
  it("counts a parent of the site, but never a public-suffix-like one", async () => {
    const { sameSite } = await import("../src/engine/documents");
    expect(sameSite("service.example", "app.service.example")).toBe(true);
    expect(sameSite("app.service.example", "service.example")).toBe(true);
    expect(sameSite("co.uk", "shop.co.uk")).toBe(false);
    expect(sameSite("com.au", "x.com.au")).toBe(false);
    expect(sameSite("example", "service.example")).toBe(false);
    expect(sameSite("other.example", "service.example")).toBe(false);
    // Real sites with short names stay sites.
    expect(sameSite("ebay.de", "login.ebay.de")).toBe(true);
    expect(sameSite("zoom.us", "app.zoom.us")).toBe(true);
    expect(sameSite("gov.uk", "service.gov.uk")).toBe(false);
    // Symmetric, siblings count, a trailing dot changes nothing.
    expect(sameSite("shop.co.uk", "co.uk")).toBe(false);
    expect(sameSite("legal.service.example", "app.service.example")).toBe(true);
    expect(sameSite("service.example.", "app.service.example")).toBe(true);
    expect(sameSite("a.shop.co.uk", "b.shop.co.uk")).toBe(true);
    expect(sameSite("shop.co.uk", "other.co.uk")).toBe(false);
  });
});

describe("reading, at the edges", () => {
  it("knows a site under a country's second-level domain", () => {
    expect(sameSite("legal.service.co.uk", "service.co.uk")).toBe(true);
    expect(sameSite("other.co.uk", "service.co.uk")).toBe(false);
  });
  it("reads exactly 300 words as a document, and not 299", () => {
    const words = (n: number) => `Terms of Service ${Array.from({ length: n - 3 }, (_, i) => `word${i}`).join(" ")}`;
    expect(readDocument("terms", "", words(300), "text/plain", rules).status).toBe("read");
    expect(readDocument("terms", "", words(299), "text/plain", rules).status).toBe("could_not_read");
    expect(kindsOfPage(`<p>${words(300)}</p>`)).toEqual(["terms"]);
    expect(kindsOfPage(`<p>${words(299)}</p>`)).toEqual([]);
  });
  it("does not read a file that is neither a web page nor plain text", () => {
    expect(readDocument("terms", "", page("Terms of Service"), "application/pdf", rules)).toMatchObject({ status: "could_not_read", reason: expect.stringContaining("PDF") });
  });
});
