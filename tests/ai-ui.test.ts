import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiOffer } from "../src/ui/ai";
import { compileRules } from "../src/engine/rules";
import { BUNDLED } from "../src/engine/bundled";

const body = "We may sell personal information to partners only when you explicitly consent.";
const doc = { kind: "terms" as const, status: "read" as const, body, url: "https://policy.example/terms", readAt: "", categories: [] };
const rules = compileRules(BUNDLED);
const response = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify([{ category: "data_sale", quote: body, explanation: "The service sells everything without asking." }]) } }] }));
const flush = () => vi.advanceTimersByTimeAsync(0);
let panel: HTMLElement;
let changed: (changes: Record<string, unknown>, area: string) => void;
const button = (text: string) => [...panel.querySelectorAll("button")].find((b) => b.textContent === text)!;
beforeEach(() => {
  vi.useFakeTimers();
  panel = document.createElement("div"); document.body.append(panel);
  vi.stubGlobal("browser", { storage: {
    local: { get: async () => ({ ai: { mode: "key", baseUrl: "https://model.example/v1", model: "fixture", apiKey: "fixture-credential" } }) },
    onChanged: { addListener: (f: typeof changed) => { changed = f; }, removeListener: vi.fn() },
  } });
});
afterEach(() => { window.dispatchEvent(new Event("pagehide")); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("AI popup controls", () => {
  it("shows coverage before sending anything and keeps retry available after failure", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("temporary failure")).mockImplementation(async () => response());
    vi.stubGlobal("fetch", fetcher); await aiOffer([doc], panel, rules);
    expect(panel.textContent).toContain("24,000");
    expect(panel.textContent).toContain("1 sequential batches");
    expect(fetcher).not.toHaveBeenCalled();
    button("Look for clauses the rules missed (AI)").click(); await flush();
    expect(panel.textContent).toContain("temporary failure");
    expect(button("Retry AI request").disabled).toBe(false);
    button("Retry AI request").click(); await flush();
    expect(panel.querySelector("blockquote")?.textContent).toBe(`“${body}”`);
    expect(panel.textContent).not.toContain("sells everything without asking");
    expect(button("AI analysis complete").disabled).toBe(true);
  });
  it("cancels a hanging request and offers an explicit retry", async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
    await aiOffer([doc], panel, rules);
    button("Look for clauses the rules missed (AI)").click(); await flush();
    const cancel = [...panel.querySelectorAll("button")].find((b) => b.textContent === "Cancel AI request" && !b.hidden)!;
    cancel.click(); await flush();
    expect(panel.textContent).toContain("cancelled");
    expect(button("Retry AI request").disabled).toBe(false);
    expect((fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1].signal?.aborted).toBe(true);
  });
  it("aborts requests when a report is replaced and refuses late results", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })); vi.stubGlobal("fetch", fetcher);
    await aiOffer([doc], panel, rules); button("Look for clauses the rules missed (AI)").click(); await flush();
    panel.replaceChildren(document.createTextNode("A different report.")); await flush();
    finish(response()); await flush();
    expect(panel.textContent).toBe("A different report.");
    expect((fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1].signal?.aborted).toBe(true);
  });
  it("stops requests and disables old credentials after AI settings change", async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
    await aiOffer([doc], panel, rules); button("Look for clauses the rules missed (AI)").click(); await flush();
    changed({ ai: {} }, "local"); await flush();
    expect(panel.textContent).toContain("AI settings changed");
    expect([...panel.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);
    expect((fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1].signal?.aborted).toBe(true);
  });
});
