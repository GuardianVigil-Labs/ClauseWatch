import { describe, it, expect } from "vitest";
import { quoteText, shareTargets, SHARE_URL } from "../src/ui/share";

describe("sharing", () => {
  it("builds plain share links with the page and text only", () => {
    const t = Object.fromEntries(shareTargets().map((s) => [s.name, new URL(s.url)]));
    expect(Object.keys(t)).toEqual(["Email", "Reddit", "X", "LinkedIn", "WhatsApp"]);
    expect(t.Reddit!.searchParams.get("url")).toBe(SHARE_URL);
    expect(t.X!.hostname).toBe("x.com");
    expect(t.LinkedIn!.searchParams.get("url")).toBe(SHARE_URL);
    expect(t.WhatsApp!.searchParams.get("text")).toContain(SHARE_URL);
    expect(t.Email!.protocol).toBe("mailto:");
    for (const s of shareTargets()) {
      // No tracking parameters ride along.
      expect(s.url).not.toMatch(/utm_|ref=|referrer/);
    }
  });

  it("escapes what it is given, so text cannot become a parameter", () => {
    const x = new URL(shareTargets("a&url=https://evil.example b").find((s) => s.name === "X")!.url);
    expect(x.searchParams.get("url")).toBe(SHARE_URL);
    expect(x.searchParams.get("text")).toBe("a&url=https://evil.example b");
  });

  it("shares a quote with its site, document and source", () => {
    expect(quoteText("service.example", "terms", "Any dispute will be resolved by binding arbitration.")).toBe(
      `Quoted from service.example's terms: “Any dispute will be resolved by binding arbitration.”, found by ClauseWatch. ${SHARE_URL}`,
    );
    expect(quoteText("service.example", "privacy", "x")).toContain("privacy policy");
    // Hidden characters are stripped and a long quote is cut.
    expect(quoteText("s.example", "terms", "a\u202Eb\u200Bc")).toContain("“abc”");
    expect(quoteText("s.example", "terms", "x".repeat(2000)).length).toBeLessThan(600);
  });
});
