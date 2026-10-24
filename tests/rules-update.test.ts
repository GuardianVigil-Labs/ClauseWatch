import { describe, it, expect, beforeAll, vi } from "vitest";
import { currentRulesFile, refreshRules, RULES_URL } from "../src/engine/rules-update";
import type { RulesFile } from "../src/engine/rules";
import type { KV } from "../src/storage";
import type { SignedRules } from "../src/engine/verify";

// Signed rule updates: fetched daily, kept only when they verify and are
// newer than anything in hand, re-verified whenever they are used.

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
let keys: Record<string, string>;
let sign: (text: string) => Promise<string>;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  keys = { k1: b64(await crypto.subtle.exportKey("raw", pair.publicKey)) };
  sign = async (text) => b64(await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(text)));
});

const rulesFile = (version: number): RulesFile => ({
  version, flags: "i", minQuoteWords: 8, categories: ["a"],
  rules: [{ id: `r${version}`, category: "a", all: ["binding arbitration"], none: [] }],
});
const bundled = rulesFile(1);

async function signed(version: number, over: Partial<SignedRules> = {}): Promise<SignedRules> {
  const text = JSON.stringify(rulesFile(version));
  return { version, rules: text, signature: await sign(text), algorithm: "Ed25519", keyId: "k1", ...over };
}

function memoryKV(init: Record<string, unknown> = {}): KV & { data: Record<string, unknown> } {
  const data = { ...init };
  return {
    data,
    get: async (k) => data[k],
    set: async (k, v) => { data[k] = v; },
    remove: async (k) => { delete data[k]; },
  };
}

const respond = (body: unknown, status = 200): typeof fetch =>
  (async (url: string) => {
    expect(url).toBe(RULES_URL);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
const offline: typeof fetch = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
const DAY = 24 * 60 * 60 * 1000;

describe("refreshRules", () => {
  it("stores a newer verified file, and the engine then uses it", async () => {
    const kv = memoryKV();
    expect(await refreshRules(kv, bundled, respond(await signed(2)), DAY, keys)).toBe(true);
    expect((await currentRulesFile(kv, bundled, keys)).version).toBe(2);
  });

  it("ignores unsigned, tampered, untrusted, same-version and mismatched files", async () => {
    const good = await signed(2);
    const bad: SignedRules[] = [
      { ...good, signature: "" },
      { ...good, rules: good.rules.replace("binding", "bonding") },
      { ...good, keyId: "someone-else" },
      await signed(1),
      { ...good, version: 7 },
    ];
    for (const b of bad) {
      const kv = memoryKV();
      expect(await refreshRules(kv, bundled, respond(b), DAY, keys)).toBe(false);
      expect((await currentRulesFile(kv, bundled, keys)).version).toBe(1);
    }
  });

  it("does not roll back to an older signed file once a newer one is stored", async () => {
    const kv = memoryKV({ "rules:update": await signed(3) });
    expect(await refreshRules(kv, bundled, respond(await signed(2)), DAY, keys)).toBe(false);
    expect((await currentRulesFile(kv, bundled, keys)).version).toBe(3);
  });

  it("keeps the stored copy when offline, on an error status, or on an oversized or malformed body", async () => {
    // A valid, newer signed file behind an error status or past the size cap is
    // still refused: each check stands on its own.
    const newer = await signed(4);
    const oversized = respond({ ...newer, padding: "x".repeat(600 * 1024) });
    for (const f of [offline, respond(newer, 503), oversized, respond("not json")]) {
      const kv = memoryKV({ "rules:update": await signed(3) });
      expect(await refreshRules(kv, bundled, f, DAY, keys)).toBe(false);
      expect((await currentRulesFile(kv, bundled, keys)).version).toBe(3);
    }
  });

  it("checks at most once a day, but retries soon after a failed fetch", async () => {
    let calls = 0;
    const counting = (async () => { calls++; return new Response(JSON.stringify(await signed(1))); }) as unknown as typeof fetch;
    const kv = memoryKV();
    await refreshRules(kv, bundled, counting, DAY, keys);
    await refreshRules(kv, bundled, counting, DAY + 60_000, keys);
    expect(calls).toBe(1);
    await refreshRules(kv, bundled, counting, 2 * DAY + 1, keys);
    expect(calls).toBe(2);

    const kv2 = memoryKV();
    await refreshRules(kv2, bundled, offline, DAY, keys);
    expect(kv2.data["rules:checkedAt"]).toBeUndefined(); // the next tick tries again
  });
});

describe("currentRulesFile", () => {
  it("uses the bundled file when the stored copy was altered or is no newer than the bundled one", async () => {
    const tampered = await signed(3);
    tampered.rules = tampered.rules.replace("binding", "bonding");
    expect((await currentRulesFile(memoryKV({ "rules:update": tampered }), bundled, keys)).version).toBe(1);
    // An extension update shipped a bundled file newer than the stored one.
    expect((await currentRulesFile(memoryKV({ "rules:update": await signed(3) }), rulesFile(4), keys)).version).toBe(4);
  });
  it("keeps the bundled known sites when a release carries none, and a release's own when it does", async () => {
    const site = { id: "service", name: "Service", domains: ["service.example"], terms: "https://service.example/terms", privacy: "https://service.example/privacy" };
    const withSites = { ...rulesFile(1), sites: [site] };
    expect((await currentRulesFile(memoryKV({ "rules:update": await signed(2) }), withSites, keys)).sites).toEqual([site]);
    const other = { ...site, id: "other", domains: ["other.example"], terms: "https://other.example/terms", privacy: "https://other.example/privacy" };
    const text = JSON.stringify({ ...rulesFile(2), sites: [other] });
    const carrying = { version: 2, rules: text, signature: await sign(text), algorithm: "Ed25519", keyId: "k1" };
    expect((await currentRulesFile(memoryKV({ "rules:update": carrying }), withSites, keys)).sites).toEqual([other]);
    // A signed release whose sites are malformed is refused whole.
    const badText = JSON.stringify({ ...rulesFile(2), sites: [{ ...other, terms: "http://other.example/terms" }] });
    const bad = { version: 2, rules: badText, signature: await sign(badText), algorithm: "Ed25519", keyId: "k1" };
    expect((await currentRulesFile(memoryKV({ "rules:update": bad }), withSites, keys)).version).toBe(1);
  });
});

describe("where rules come from", () => {
  it("is the latest GitHub release's signed file, and nothing else", async () => {
    expect(RULES_URL).toBe("https://github.com/GuardianVigil-Labs/ClauseWatch/releases/latest/download/rules.signed.json");
    const seen: string[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push(url);
      expect(init.credentials).toBe("omit");
      return new Response(JSON.stringify(await signed(2)));
    }) as unknown as typeof fetch;
    expect(await refreshRules(memoryKV(), bundled, f, DAY, keys)).toBe(true);
    expect(seen).toEqual([RULES_URL]);
  });

  it("reads an answer of exactly 512 KB, and not one byte more", async () => {
    const body = JSON.stringify(await signed(2));
    const sized = (n: number) => body.slice(0, -1) + " ".repeat(n - body.length) + "}";
    expect(await refreshRules(memoryKV(), bundled, respond(sized(512 * 1024)), DAY, keys)).toBe(true);
    expect(await refreshRules(memoryKV(), bundled, respond(sized(512 * 1024 + 1)), DAY, keys)).toBe(false);
  });

  it("refuses an answer that says it is over 512 KB before reading it", async () => {
    const body = JSON.stringify(await signed(2));
    const text = vi.fn();
    const big = (async () => {
      const res = new Response(body, { headers: { "content-length": String(512 * 1024 + 1) } });
      Object.defineProperty(res, "text", { value: text });
      return res;
    }) as unknown as typeof fetch;
    expect(await refreshRules(memoryKV(), bundled, big, DAY, keys)).toBe(false);
    expect(text).not.toHaveBeenCalled();
    // Exactly the limit is read.
    const at = (async () => new Response(body, { headers: { "content-length": String(512 * 1024) } })) as unknown as typeof fetch;
    expect(await refreshRules(memoryKV(), bundled, at, DAY, keys)).toBe(true);
  });

  it("refuses a body that is not a signed file at all", async () => {
    for (const body of ["null", "5", '"text"', "[]"]) expect(await refreshRules(memoryKV(), bundled, respond(body), DAY, keys)).toBe(false);
  });

  it("counts a missing release as checked, so it is not asked for again until tomorrow", async () => {
    const kv = memoryKV();
    expect(await refreshRules(kv, bundled, respond("Not Found", 404), DAY, keys)).toBe(false);
    expect(kv.data["rules:checkedAt"]).toBe(DAY);
  });
});
