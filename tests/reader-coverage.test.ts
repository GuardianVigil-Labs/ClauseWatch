import { describe, expect, it } from "vitest";
import rulesFile from "../rules/rules.json";
import { compileRules, type RulesFile } from "../src/engine/rules";
import { discoverLinks, kindsOfPage, readDocument, sameSite } from "../src/engine/documents";
import { htmlToBlocks } from "../src/engine/document";
import { scanPasted, scanUrl, scanTargets } from "../src/ui/scan";
import { languageCoverage } from "../src/engine/language";
import { mayFetch } from "../src/auto/background";
import { reportCards } from "../src/ui/report";

const rules = compileRules(rulesFile as RulesFile);
const clause = "We collect your email address and delete it when you close your account.";

describe("short policies and explicit document choices", () => {
  it("reads a legitimate short policy and refuses a sign-in wall", () => {
    expect(readDocument("privacy", "", `Privacy Policy. ${clause}`, "text/plain", rules)).toMatchObject({ status: "read" });
    const wall = "<h1>Privacy Policy</h1><p>Please sign in to continue and view the information you requested.</p>";
    expect(kindsOfPage(wall)).toEqual([]);
    expect(readDocument("privacy", "", wall, "text/html", rules)).toMatchObject({ status: "could_not_read" });
  });
  it("accepts unfamiliar names only when a user chooses the type, with a coverage notice", async () => {
    expect(readDocument("privacy", "", clause, "text/plain", rules).status).toBe("could_not_read");
    expect(scanPasted(clause, "privacy", rules).documents[0]).toMatchObject({ status: "read", notices: [expect.stringContaining("You chose")] });
    expect(scanPasted("Too little text.", "privacy", rules).documents[0]).toMatchObject({ status: "could_not_read", reason: expect.stringContaining("Not enough") });
    const fetched = async (url: string) => ({ ok: true as const, url, text: `<p>${clause}</p>`, contentType: "text/html" });
    expect((await scanUrl("https://service.example/custom", "privacy", rules, fetched)).documents[0]?.status).toBe("read");
    expect((await scanUrl("https://service.example/custom", "auto", rules, fetched)).documents[0]?.status).toBe("could_not_read");
  });
  it.each(["Customer Agreement", "Subscription Agreement", "Master Services Agreement", "End-User License Agreement", "Terms of Sale"])("recognises %s", (heading) => {
    expect(kindsOfPage(`<h1>${heading}</h1><p>${clause}</p>`)).toEqual(["terms"]);
  });
  it("does not turn footer policy links into a document identity", () => {
    const home = `<h1>Join our service</h1><p>${clause}</p><footer><a href='/privacy'>Privacy Policy</a><a href='/terms'>Terms of Service</a></footer>`;
    expect(kindsOfPage(home)).toEqual([]);
  });
});

describe("domain boundaries and external policies", () => {
  it("separates private suffix tenants and supports country-code suffix rules", () => {
    for (const suffix of ["github.io", "pages.dev", "vercel.app", "netlify.app", "s3.amazonaws.com"]) {
      expect(sameSite(`alpha.${suffix}`, `beta.${suffix}`), suffix).toBe(false);
      expect(mayFetch(`https://alpha.${suffix}/terms`, `https://beta.${suffix}/join`)).toBe(false);
      expect(sameSite(`legal.alpha.${suffix}`, `alpha.${suffix}`)).toBe(true);
    }
    expect(sameSite("a.service.com.ar", "b.service.com.ar")).toBe(true);
    expect(sameSite("service.com.ar", "other.com.ar")).toBe(false);
    expect(sameSite("www.city.kawasaki.jp", "city.kawasaki.jp")).toBe(true);
  });
  it("offers external hosts only through explicit discovery, never as automatic fetch authority", () => {
    const html = '<a href="https://legal.provider.example/client/privacy">Privacy Policy</a><a data-url="https://legal.provider.example/client/terms" role="link">Terms of Service</a>';
    expect(discoverLinks(html, "https://service.example/")).toEqual({ terms: [], privacy: [] });
    const offered = discoverLinks(html, "https://service.example/", { external: true });
    expect(offered.privacy).toEqual(["https://legal.provider.example/client/privacy"]);
    expect(offered.terms).toEqual(["https://legal.provider.example/client/terms"]);
    expect(mayFetch(offered.privacy[0]!, "https://service.example/")).toBe(false);
  });
  it("never offers credential-bearing, private, hidden or non-web destinations", () => {
    const html = '<a href="http://192.0.2.10/privacy">Privacy Policy</a><a href="https://user:password@provider.example/privacy">Privacy</a><a hidden href="https://provider.example/privacy">Privacy</a><a href="javascript:void(0)">Terms</a><a style="display:none" href="/terms">Terms</a>';
    expect(discoverLinks(html, "https://service.example/", { external: true })).toEqual({ terms: [], privacy: [] });
  });
  it("scans a final PDF URL directly instead of replacing it with a known site's landing URL", () => {
    const known = [{ id: "service", name: "Service", domains: ["service.example"], terms: "https://service.example/terms", privacy: "https://service.example/privacy" }];
    expect(scanTargets("https://service.example/policy.pdf", "auto", known)).toEqual([{ url: "https://service.example/policy.pdf", kind: "auto" }]);
  });
});

describe("language guesses never suppress the English rules", () => {
  // A normal English policy on which the local estimate is not confident.
  const page = (lang: string) => `<html lang="${lang}"><h1>Terms of Service</h1><p>Last updated: January 1, 2026</p><h2>1. Accounts</h2><h2>2. Payments</h2><p>Your subscription renews automatically each month until you cancel it.</p><h2>3. Disputes</h2><p>Any dispute arising from these terms will be resolved by binding arbitration rather than in court.</p><h2>4. Contact</h2></html>`;
  const found = (r: ReturnType<typeof readDocument>) => r.status === "read" ? r.categories.filter((c) => c.status === "found").map((c) => c.category).sort() : [];

  it("is a guess on this text, not a confident identification", () => {
    const result = readDocument("terms", "", page(""), "text/html", rules);
    expect(result).toMatchObject({ status: "read", coverage: { language: "en" } });
    if (result.status === "read") expect(result.coverage?.confident).not.toBe(true);
  });
  it("finds the English clauses whatever language the page claims", () => {
    const expected = found(readDocument("terms", "", page("en"), "text/html", rules));
    expect(expected).toEqual(expect.arrayContaining(["arbitration", "auto_renewal"]));
    for (const lang of ["", "es", "fr", "de", "xx"]) expect(found(readDocument("terms", "", page(lang), "text/html", rules)), lang).toEqual(expected);
  });
  it("runs the matching pack alongside the English rules and says so", () => {
    const result = readDocument("terms", "", page("es"), "text/html", rules);
    expect(result).toMatchObject({ status: "read", coverage: { language: "es", status: "supported" } });
    const text = reportCards({ site: "service.example", documents: [result] }).map((c) => c.textContent).join(" ");
    expect(text).toContain("alongside the English rules");
    expect(text).not.toContain("English and custom rules are not applied");
  });
  it("treats a page marked with a language without a pack as English when the text is not identified", () => {
    const result = readDocument("terms", "", page("de"), "text/html", rules);
    const text = reportCards({ site: "service.example", documents: [result] }).map((c) => c.textContent).join(" ");
    expect(text).toContain("could not be identified confidently");
    expect(text).not.toContain("No built-in rule pack");
    expect(text).toContain("Not found:");
  });
});

describe("language and visibility coverage", () => {
  it("checks text identified as a language without a pack with the English rules, and never claims a topic is absent", () => {
    const result = readDocument("privacy", "", `<html lang="de"><h1>Privacy Policy</h1><p>Diese Erklärung beschreibt, wie wir Ihre personenbezogenen Daten erheben, verwenden und weitergeben, wenn Sie unseren Dienst nutzen. Wir erheben die Informationen, die Sie uns bei der Erstellung eines Kontos geben, etwa Ihren Namen und Ihre E-Mail-Adresse. Sie können jederzeit die Löschung Ihres Kontos verlangen.</p></html>`, "text/html", rules);
    expect(result).toMatchObject({ status: "read", coverage: { language: "de", status: "unsupported", confident: true } });
    if (result.status === "read") expect(result.categories.map((c) => c.category).sort()).toEqual([...rules.categories].sort());
    const cards = reportCards({ site: "service.example", documents: [result] }).map((c) => c.textContent).join(" ");
    expect(cards).toContain("No built-in rule pack");
    expect(cards).not.toContain("0 found");
    expect(cards).not.toContain("Not found:");
  });
  it("detects unsupported text without language metadata and keeps uncertain text explicit", () => {
    const french = "Nous recueillons vos informations personnelles afin de fournir notre service. Vous pouvez demander la suppression de vos données et la fermeture de votre compte à tout moment. Nous ne partageons pas vos informations avec des entreprises publicitaires.";
    expect(languageCoverage(french).status).toBe("supported");
    expect(languageCoverage("xyzzy qqqq 12345")).toEqual({ language: "und", status: "unknown", confident: false });
    expect(languageCoverage(clause).status).toBe("english");
  });
  it("excludes explicit hidden markers and inline CSS from extracted evidence", () => {
    const html = `<h1>Privacy Policy</h1><p>${clause}</p><p hidden>Hidden personal data sale.</p><p aria-hidden='true'>Hidden AI training.</p><div style='display:none'><p>Hidden advertising.</p></div><span style='visibility:hidden'>Hidden location.</span>`;
    const body = htmlToBlocks(html).join(" ");
    expect(body).toContain(clause);
    expect(body).not.toContain("Hidden");
  });
  it("distinguishes downloaded HTML from a verified visible-page snapshot", () => {
    const html = `<h1>Privacy Policy</h1><p>${clause}</p>`;
    expect(readDocument("privacy", "", html, "text/html", rules)).toMatchObject({ notices: [expect.stringContaining("downloaded HTML")] });
    expect(readDocument("privacy", "", html, "text/html", rules, { rendered: true })).toMatchObject({ notices: [] });
  });
});
