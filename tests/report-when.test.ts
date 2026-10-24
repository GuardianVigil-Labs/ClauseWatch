import { describe, expect, it, vi } from "vitest";
import { readWhen, reportCards } from "../src/ui/report";
import type { DocumentResult } from "../src/engine/documents";

describe("when a document was read", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  it("says just now, minutes, or the date", () => {
    expect(readWhen("2026-01-01T11:59:30Z", now)).toBe("just now");
    expect(readWhen("2026-01-01T11:59:00Z", now)).toBe("1 min ago");
    expect(readWhen("2026-01-01T11:01:00Z", now)).toBe("59 min ago");
    expect(readWhen("2026-01-01T11:00:00Z", now)).toBe(new Date("2026-01-01T11:00:00Z").toLocaleString());
    expect(readWhen("2026-01-01T12:05:00Z", now)).toBe(new Date("2026-01-01T12:05:00Z").toLocaleString());
  });
});

describe("the report's cards", () => {
  const terms: DocumentResult = {
    kind: "terms", status: "read", url: "https://service.example/terms", readAt: new Date().toISOString(), body: "x",
    categories: [
      { category: "ai_training", status: "found", findings: [{ quote: "We train models on your content." } as never] },
      { category: "arbitration", status: "found", findings: [{ quote: "Disputes go to arbitration." } as never] },
      { category: "data_sale", status: "not_found", findings: [] },
    ],
  };
  const unread: DocumentResult = { kind: "privacy", status: "could_not_read", reason: "It needs sign-in." };

  it("a site card, one card per finding with its tone and badge, then what was not found and what was not read", () => {
    const onQuote = vi.fn();
    const cards = reportCards({ site: "service.example", documents: [terms, unread], onQuote });
    expect(cards.map((c) => c.className)).toEqual(["card site", "card finding red", "card finding amber", "card", "card"]);
    expect(cards[0]!.textContent).toContain("service.example");
    expect(cards[0]!.querySelector(".badge")!.textContent).toBe("2 found");
    expect(cards[0]!.querySelector(".initial")!.textContent).toBe("S");
    expect(cards[1]!.querySelector("blockquote")!.textContent).toBe("“We train models on your content.”");
    expect(cards[1]!.querySelector(".badge")!.textContent).toBe("AI training");
    expect(cards[1]!.querySelector("a")!.getAttribute("href")).toBe("https://service.example/terms");
    cards[2]!.querySelector("button")!.click();
    expect(onQuote).toHaveBeenCalledWith("terms", "Disputes go to arbitration.");
    expect(cards[3]!.textContent).toContain("Not found: Sale or brokering of personal data");
    expect(cards[3]!.querySelector("a")!.getAttribute("href")).toBe("https://service.example/terms");
    expect(cards[1]!.querySelector(".allows")!.textContent).toContain("train or improve AI models");
    expect(reportCards({ site: "service.example", documents: [terms], siteCard: false })[0]!.className).toBe("card finding red");
    expect(cards[3]!.textContent).not.toContain("AI training on your content");
    expect(cards[4]!.textContent).toContain("Could not read this document. It needs sign-in.");
    // Never a verdict.
    expect(cards.map((c) => c.textContent).join(" ")).not.toMatch(/\bsafe\b(?!”)/i);
  });

  it("pasted text has no link or share button; nothing found shows a plain badge and no not-found card when all were found", () => {
    const pasted = { ...terms, url: "pasted", categories: [terms.categories[2]!] } as DocumentResult;
    const cards = reportCards({ site: "Pasted text", documents: [pasted] });
    expect(cards[0]!.querySelector(".badge")!.className).toBe("badge plain");
    expect(cards[0]!.querySelector(".badge")!.textContent).toBe("0 found");
    const all = reportCards({ site: "service.example", documents: [{ ...terms, url: "notaurl", categories: [terms.categories[0]!] } as DocumentResult] });
    expect(all).toHaveLength(2);
    expect(all[1]!.querySelector("a")).toBeNull();
    expect(all[1]!.querySelector("button")).toBeNull();
    expect(all[1]!.textContent).toContain("pasted text");
  });

  it("lists every document checked, linking each that has an address, and only topics no document found", () => {
    const privacy = { ...terms, kind: "privacy", url: "pasted", categories: [{ category: "data_sale", status: "found", findings: [{ quote: "We sell data." } as never] }, { category: "ad_sharing", status: "not_found", findings: [] }] } as DocumentResult;
    const cards = reportCards({ site: "service.example", documents: [terms, privacy] });
    const absent = cards[cards.length - 1]!;
    expect(absent.querySelector(".meta")!.textContent).toBe("Checked: Terms of service ↗, Privacy policy. “Not found” is not “safe”.");
    expect(absent.querySelectorAll("a")).toHaveLength(1);
    expect(absent.textContent).toContain("Not found: Data shared for advertising");
    expect(absent.textContent).not.toContain("Sale or brokering");
  });

  it("no documents: the site card says there was nothing to read here", () => {
    const [card, ...rest] = reportCards({ site: "news.example", documents: [] });
    expect(card!.textContent).toContain("No sign-up form or terms on this page");
    expect(card!.querySelector(".badge")).toBeNull();
    expect(rest).toHaveLength(0);
    expect(reportCards({ site: "x.example", documents: [unread] })[0]!.textContent).toContain("Nothing could be read");
  });
});
