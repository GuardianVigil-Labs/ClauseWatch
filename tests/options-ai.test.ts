import { afterEach, describe, expect, it, vi } from "vitest";
import { aiEndpoint } from "../src/ai/settings";

const flush = () => new Promise((r) => setTimeout(r, 0));
const input = (el: HTMLInputElement | HTMLSelectElement, value: string, type = "input") => { el.value = value; el.dispatchEvent(new Event(type)); };

/** Settings drawn in a page with the stored AI settings, with every permission call recorded. */
async function open(stored: unknown) {
  vi.resetModules();
  document.body.innerHTML = ["automatic", "ai", "rules", "sites", "about-host"].map((id) => `<div id="${id}"></div>`).join("");
  const data: Record<string, unknown> = { ai: stored };
  const permissions = { request: vi.fn(async () => true), remove: vi.fn(async () => true), contains: vi.fn(async () => false) };
  vi.stubGlobal("browser", {
    storage: { local: { get: async (k: string) => ({ [k]: data[k] }), set: async (o: Record<string, unknown>) => { Object.assign(data, o); } }, onChanged: { addListener: () => {} } },
    permissions,
    runtime: { getURL: (p: string) => p, sendMessage: async () => ({ ok: true }) },
    tabs: { create: async () => {} },
  });
  await import("../entrypoints/options/main");
  await flush(); await flush();
  const ai = document.getElementById("ai")!;
  const field = (label: string) => ai.querySelector<HTMLInputElement & HTMLSelectElement>(`[aria-label="${label}"]`)!;
  const save = async () => { [...ai.querySelectorAll("button")].find((b) => b.textContent === "Save")!.click(); await flush(); await flush(); };
  return { data, permissions, field, save, ai };
}
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("AI settings", () => {
  it("binds a new key to the address saved, even when the address is edited after the key", async () => {
    const x = await open(undefined);
    input(x.field("AI help"), "key", "change");
    input(x.field("API address"), "https://ai.example");
    input(x.field("Model"), "fixture-model");
    input(x.field("API key"), "fixture-key");
    input(x.field("API address"), "https://ai.example/v1");
    await x.save();
    expect(x.data.ai).toMatchObject({ mode: "key", apiKey: "fixture-key", baseUrl: "https://ai.example/v1", credentialEndpoint: aiEndpoint("https://ai.example/v1") });
  });

  it("still asks for a choice before the saved key goes to a new address", async () => {
    const saved = { mode: "key", baseUrl: "https://old.example/v1", model: "m", apiKey: "saved-key", credentialEndpoint: aiEndpoint("https://old.example/v1") };
    const x = await open(saved);
    input(x.field("API address"), "https://new.example/v1");
    await x.save();
    expect(x.data.ai).toEqual(saved);
    expect(x.ai.textContent).toContain("Choose a credential");
  });

  it("gives back the previous AI address's access when the address changes or AI is turned off", async () => {
    const saved = { mode: "key", baseUrl: "https://old.example/v1", model: "m", apiKey: "saved-key", credentialEndpoint: aiEndpoint("https://old.example/v1") };
    const x = await open(saved);
    input(x.field("API address"), "https://new.example/v1");
    input(x.field("API key"), "new-key");
    await x.save();
    expect(x.data.ai).toMatchObject({ baseUrl: "https://new.example/v1", apiKey: "new-key" });
    expect(x.permissions.remove).toHaveBeenCalledExactlyOnceWith({ origins: ["https://old.example/*"] });
    input(x.field("AI help"), "off", "change");
    await x.save();
    expect(x.data.ai).toEqual({ mode: "off" });
    expect(x.permissions.remove).toHaveBeenLastCalledWith({ origins: ["https://new.example/*"] });
  });

  it("keeps the address's access when only the path changes, and while automatic mode holds every site", async () => {
    const saved = { mode: "key", baseUrl: "https://old.example/v1", model: "m", apiKey: "saved-key", credentialEndpoint: aiEndpoint("https://old.example/v1") };
    const x = await open(saved);
    input(x.field("API address"), "https://old.example/v2");
    input(x.field("API key"), "new-key");
    await x.save();
    expect(x.data.ai).toMatchObject({ baseUrl: "https://old.example/v2" });
    x.permissions.contains.mockResolvedValue(true);
    input(x.field("AI help"), "off", "change");
    await x.save();
    expect(x.permissions.remove).not.toHaveBeenCalled();
  });
});
