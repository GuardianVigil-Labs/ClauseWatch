import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUNDLED } from "../src/engine/bundled";
import { compileRules, type RulesFile } from "../src/engine/rules";
import type { DocumentResult, Kind } from "../src/engine/documents";
import { readFirst } from "../src/ui/scan";
import { fillReport } from "../src/ui/report";
import { loadRules } from "../src/engine/rule-set";
import { currentRulesFile } from "../src/engine/rules-update";

vi.mock("../src/ui/scan", () => ({ readFirst: vi.fn() }));
vi.mock("../src/ui/report", () => ({ fillReport: vi.fn() }));
vi.mock("../src/engine/rule-set", () => ({ loadRules: vi.fn() }));
vi.mock("../src/engine/rules-update", () => ({ currentRulesFile: vi.fn() }));
vi.mock("../src/engine/rendered", () => ({ captureRenderedPage: () => ({ html: '<a href="/terms">Terms</a><a href="/privacy">Privacy</a>', truncated: false }) }));

type Change = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
type Message = (message: { type: string }, sender: { id: string }) => void;
let change: Change;
let message: Message;
let allowed: boolean;
let remembered: DocumentResult[] | null;
let send: ReturnType<typeof vi.fn>;
const success = (kind: Kind): DocumentResult => ({ kind, status: "read", url: `https://signup.example/${kind}`, readAt: "2026-10-14T00:00:00Z", categories: [], body: "This invented policy explains how membership works for registered users." });
const flush = () => vi.advanceTimersByTimeAsync(0);
const focus = () => document.querySelector("input")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
const report = () => vi.mocked(fillReport).mock.calls.at(-1)?.[1];

async function boot(html = '<div><input type="email"><input type="password" autocomplete="new-password"></div>') {
  document.body.innerHTML = html;
  const content = await import("../entrypoints/signup.content");
  await (content.default as unknown as { main: () => Promise<void> }).main();
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  allowed = true;
  remembered = null;
  history.replaceState(null, "", "/start");
  vi.stubGlobal("defineContentScript", (config: unknown) => config);
  vi.mocked(currentRulesFile).mockResolvedValue(BUNDLED);
  vi.mocked(loadRules).mockResolvedValue(compileRules(BUNDLED));
  vi.mocked(readFirst).mockImplementation(async (kind) => success(kind));
  send = vi.fn(async (m: { type: string; documents?: DocumentResult[] }) => {
    if (m.type === "auto:state") return allowed;
    if (m.type === "docs:get") return { key: "rules", documents: remembered };
    if (m.type === "docs:put") { remembered = m.documents!; return true; }
  });
  vi.stubGlobal("browser", {
    runtime: { id: "extension", sendMessage: send, onMessage: { addListener: (f: Message) => { message = f; } } },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener: (f: Change) => { change = f; } } },
  });
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("automatic content lifecycle", () => {
  it("does not observe or read while disabled, and can resume after authorization", async () => {
    allowed = false;
    await boot(); focus(); await flush();
    expect(readFirst).not.toHaveBeenCalled();
    allowed = true;
    change({ automatic: { newValue: true } }, "local"); await flush();
    focus(); await flush();
    expect(readFirst).toHaveBeenCalledTimes(2);
  });
  it("stops an injected script and ignores an outstanding result", async () => {
    let finish!: (d: DocumentResult) => void;
    vi.mocked(readFirst).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await boot(); focus(); await flush();
    expect(document.querySelector("[popover]")).not.toBeNull();
    allowed = false;
    change({ automatic: { newValue: false } }, "local");
    expect(document.querySelector("[popover]")).toBeNull();
    finish(success("terms")); await flush();
    focus(); await vi.advanceTimersByTimeAsync(3000);
    expect(readFirst).toHaveBeenCalledTimes(1);
    expect(fillReport).not.toHaveBeenCalled();
    expect(send.mock.calls.some(([m]) => m.type === "docs:put")).toBe(false);
  });
  it("shuts down on a permission notification even when the preference remains on", async () => {
    await boot(); focus(); await flush();
    expect(fillReport).toHaveBeenCalled();
    allowed = false;
    message({ type: "auto:sync" }, { id: "extension" }); await flush();
    expect(document.querySelector("[popover]")).toBeNull();
    const count = vi.mocked(readFirst).mock.calls.length;
    focus(); await vi.advanceTimersByTimeAsync(1500);
    expect(readFirst).toHaveBeenCalledTimes(count);
  });
  it("reports thrown reads, releases the attempt, and retries only the failed kind", async () => {
    vi.mocked(readFirst).mockImplementationOnce(async () => { throw new Error("unavailable"); });
    await boot(); focus(); await flush();
    expect(report()?.documents).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "terms", status: "could_not_read", reason: expect.stringContaining("Try again") })]));
    expect(remembered?.some((d) => d.kind === "privacy" && d.status === "read")).toBe(true);
    focus(); await flush();
    expect(vi.mocked(readFirst).mock.calls.map(([kind]) => kind)).toEqual(["terms", "privacy", "terms"]);
    expect(report()?.documents.every((d) => d.status === "read")).toBe(true);
  });
  it("retries a cached partial report on a fresh page instead of quieting it", async () => {
    remembered = [success("terms"), { kind: "privacy", status: "could_not_read", reason: "Temporary failure." }];
    await boot(); focus(); await flush();
    expect(vi.mocked(readFirst).mock.calls.map(([kind]) => kind)).toEqual(["privacy"]);
    expect(report()?.documents.every((d) => d.status === "read")).toBe(true);
  });
  it("keeps a fully cached site quiet and uses the badge instead", async () => {
    remembered = [success("terms"), success("privacy")];
    await boot(); focus(); await flush();
    expect(readFirst).not.toHaveBeenCalled();
    expect(document.querySelector("[popover]")).toBeNull();
    expect(send).toHaveBeenCalledWith({ type: "badge" });
  });
  it("recovers from a rejected rule-loading promise on the next attempt", async () => {
    vi.mocked(loadRules).mockRejectedValueOnce(new Error("storage unavailable"));
    await boot(); focus(); await flush();
    expect(report()?.documents[0]).toMatchObject({ status: "could_not_read" });
    focus(); await flush();
    expect(loadRules).toHaveBeenCalledTimes(2);
    expect(readFirst).toHaveBeenCalledTimes(2);
  });
  it("recognizes autocomplete and visibility changes without adding nodes", async () => {
    await boot('<div style="display:none"><input type="email"><input type="password" autocomplete="current-password"></div>');
    focus(); await flush();
    expect(readFirst).not.toHaveBeenCalled();
    document.querySelector("div")!.style.display = "block";
    document.querySelector<HTMLInputElement>('input[type="password"]')!.autocomplete = "new-password";
    await vi.advanceTimersByTimeAsync(300);
    focus(); await flush();
    expect(readFirst).toHaveBeenCalledTimes(2);
  });
  it("handles pushState navigation to a known sign-up page without DOM mutations", async () => {
    const host = location.hostname;
    const file: RulesFile = { ...BUNDLED, sites: [{ id: "invented", name: "Invented", domains: [host], terms: `https://${host}/terms`, privacy: `https://${host}/privacy`, signup: [`${location.origin}/join`] }] };
    vi.mocked(currentRulesFile).mockResolvedValue(file);
    await boot("<p>Welcome</p>");
    expect(readFirst).not.toHaveBeenCalled();
    history.pushState(null, "", "/join");
    await vi.advanceTimersByTimeAsync(1100);
    expect(readFirst).toHaveBeenCalledTimes(2);
  });
  it("discovers a shadow root attached after startup and its focused form", async () => {
    await boot('<div id="host"></div>');
    const root = document.querySelector("#host")!.attachShadow({ mode: "open" });
    root.innerHTML = '<div><input type="email"></div><div><input type="password" autocomplete="new-password"></div>';
    await vi.advanceTimersByTimeAsync(1100);
    root.querySelector("input")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    await flush();
    expect(readFirst).toHaveBeenCalledTimes(2);
  });
});

describe("automatic mode's cost on a page", () => {
  it("never walks the page on its one-second check", async () => {
    await boot('<div><input type="email"><input type="password" autocomplete="new-password"></div>' + "<div><p>Filler</p></div>".repeat(50));
    const documentQueries = vi.spyOn(document, "querySelectorAll");
    const elementQueries = vi.spyOn(Element.prototype, "querySelectorAll");
    await vi.advanceTimersByTimeAsync(5000);
    expect(documentQueries).not.toHaveBeenCalled();
    expect(elementQueries).not.toHaveBeenCalled();
    expect(readFirst).not.toHaveBeenCalled();
  });

  it("in a frame, shows no card of its own, sends its report to the top frame, and runs no timer", async () => {
    vi.stubGlobal("top", {});
    const timers = vi.spyOn(globalThis, "setInterval");
    await boot();
    expect(timers).not.toHaveBeenCalled();
    focus(); await flush();
    expect(document.querySelector("[popover]")).toBeNull();
    const cards = send.mock.calls.map(([m]) => m).filter((m) => m.type === "auto:card");
    expect(cards[0]).toEqual({ type: "auto:card", documents: null });
    expect(cards.at(-1)?.documents?.map((d: DocumentResult) => d.kind)).toEqual(["terms", "privacy"]);
    expect(fillReport).not.toHaveBeenCalled();
  });

  it("in the top frame, shows a frame's report in its one card unless its own card is up", async () => {
    await boot("<p>Welcome</p>");
    const show = (documents: DocumentResult[] | null) => message({ type: "auto:show", site: "embedded.example", documents } as { type: string }, { id: "extension" });
    show(null);
    expect(document.querySelectorAll("[popover]")).toHaveLength(1);
    show([success("terms"), success("privacy")]);
    expect(document.querySelectorAll("[popover]")).toHaveLength(1);
    expect(report()?.site).toBe("embedded.example");
    window.dispatchEvent(new Event("pagehide"));
    vi.mocked(fillReport).mockClear();
    await boot();
    focus(); await flush();
    expect(report()?.site).toBe(location.hostname.replace(/^www\./, ""));
    show([success("terms")]);
    expect(report()?.site).not.toBe("embedded.example");
    expect(document.querySelectorAll("[popover]")).toHaveLength(1);
  });
});
