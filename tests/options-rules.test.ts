import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRules } from "../entrypoints/options/rules";

const visible = (node: Element | null) => {
  for (let e = node; e; e = e.parentElement) if ((e as HTMLElement).hidden) return false;
  return node !== null;
};
const flush = () => new Promise((r) => setTimeout(r, 0));
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host);
  vi.stubGlobal("browser", {
    storage: { local: { get: async () => ({ ownRules: [{ id: "own-x", title: "Fixture rule", category: "auto_renewal", all: ["a"], none: [], examples: { match: [], noMatch: [] } }] }) } },
    runtime: { sendMessage: vi.fn(async () => ({ ok: false, reason: "Fixture refusal." })) },
  });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("rule settings errors", () => {
  const shown = () => [...host.querySelectorAll("p")].find((p) => p.textContent === "Fixture refusal.") ?? null;
  it("shows a failed switch on the open tab, not in the hidden Import tab", async () => {
    await renderRules(host);
    const box = host.querySelector<HTMLInputElement>("#rules-signed input[role=switch]")!;
    box.checked = false; box.dispatchEvent(new Event("change"));
    await flush(); await flush();
    expect(visible(shown())).toBe(true);
  });
  it("shows a failed delete on My rules", async () => {
    await renderRules(host);
    host.querySelector<HTMLButtonElement>("#rules-tab-mine")!.click();
    host.querySelector<HTMLButtonElement>("#delete-own-x")!.click();
    await flush(); await flush();
    expect(visible(shown())).toBe(true);
  });
});
