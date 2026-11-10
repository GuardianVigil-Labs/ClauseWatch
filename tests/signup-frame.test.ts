import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let send: ReturnType<typeof vi.fn>;
const flush = () => new Promise((r) => setTimeout(r, 0));
const focus = () => document.querySelector("input")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
const asks = () => send.mock.calls.filter(([m]) => m.type === "auto:frame").length;

async function boot() {
  document.body.innerHTML = '<input type="email">';
  vi.resetModules();
  const content = await import("../entrypoints/signup-frame.content");
  (content.default as unknown as { main: () => void }).main();
}

beforeEach(() => {
  send = vi.fn();
  vi.stubGlobal("defineContentScript", (config: unknown) => config);
  vi.stubGlobal("top", {});
  vi.stubGlobal("browser", { runtime: { sendMessage: send } });
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("frame field check", () => {
  it("asks again after a refusal or a failure, and stops once the reader was added", async () => {
    send.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("no frame")).mockResolvedValueOnce(true);
    await boot();
    focus(); await flush();
    focus(); await flush();
    focus(); await flush();
    expect(asks()).toBe(3);
    focus(); await flush();
    expect(asks()).toBe(3);
  });

  it("sends one request at a time", async () => {
    send.mockReturnValue(new Promise(() => undefined));
    await boot();
    focus(); focus(); await flush();
    expect(asks()).toBe(1);
  });

  it("gives up after a few refusals", async () => {
    send.mockResolvedValue(false);
    await boot();
    for (let i = 0; i < 10; i++) { focus(); await flush(); }
    expect(asks()).toBe(5);
  });
});
