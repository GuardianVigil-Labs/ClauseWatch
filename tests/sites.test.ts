import { describe, it, expect } from "vitest";
import { isMuted, mute, mutedSites, shouldShowCard, unmute } from "../src/ui/sites";
import type { KV } from "../src/storage";

const memory = (): KV => {
  const m = new Map<string, unknown>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), remove: async (k) => void m.delete(k) } as KV;
};

describe("muted sites", () => {
  it("mutes and unmutes a site, once each", async () => {
    const kv = memory();
    await mute(kv, "service.example");
    await mute(kv, "service.example");
    expect(await mutedSites(kv)).toEqual(["service.example"]);
    expect(await isMuted(kv, "service.example")).toBe(true);
    await unmute(kv, "service.example");
    expect(await isMuted(kv, "service.example")).toBe(false);
  });

  it("a muted site does not show the card, and a site checked recently stays quiet", () => {
    expect(shouldShowCard({ muted: false, checkedRecently: false })).toBe(true);
    expect(shouldShowCard({ muted: true, checkedRecently: false })).toBe(false);
    expect(shouldShowCard({ muted: false, checkedRecently: true })).toBe(false);
    expect(shouldShowCard({ muted: true, checkedRecently: true })).toBe(false);
  });
});
