import { describe, it, expect, beforeAll } from "vitest";
import { verifiedRules, type SignedRules } from "../src/engine/verify";

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
let pub = "";
let sign: (text: string) => Promise<string>;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  pub = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
  sign = async (text) => b64(await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(text)));
});

const file = (version: number, pattern = "binding arbitration") =>
  JSON.stringify({ version, flags: "i", minQuoteWords: 8, categories: ["a"], rules: [{ id: "r1", category: "a", all: [pattern], none: [] }] });

describe("signed rule updates", () => {
  it("uses a newer file only when its signature verifies against a trusted key", async () => {
    const text = file(2);
    const signed: SignedRules = { version: 2, rules: text, signature: await sign(text), algorithm: "Ed25519", keyId: "k1" };
    expect((await verifiedRules(signed, { k1: pub }, 1))?.version).toBe(2);
  });

  it("keeps the bundled copy for a tampered, unsigned, untrusted or older file", async () => {
    const text = file(2);
    const sig = await sign(text);
    const cases: [SignedRules, number][] = [
      [{ version: 2, rules: text.replace("2", "3"), signature: sig, algorithm: "Ed25519", keyId: "k1" }, 1],
      [{ version: 2, rules: text, signature: "", algorithm: "Ed25519", keyId: "k1" }, 1],
      [{ version: 2, rules: text, signature: sig, algorithm: "Ed25519", keyId: "unknown" }, 1],
      [{ version: 2, rules: text, signature: sig, algorithm: "RSA", keyId: "k1" }, 1],
      [{ version: 2, rules: text, signature: sig, algorithm: "Ed25519", keyId: "k1" }, 2],
      [{ version: 2, rules: text, signature: "not base64!", algorithm: "Ed25519", keyId: "k1" }, 1],
    ];
    for (const [signed, bundled] of cases) expect(await verifiedRules(signed, { k1: pub }, bundled)).toBeNull();
  });
  it("refuses a signature that names no key, even when a trusted key would verify it", async () => {
    // Found by mutation testing: a missing keyId alone was never refused.
    const text = file(2);
    expect(await verifiedRules({ version: 2, rules: text, signature: await sign(text), algorithm: "Ed25519", keyId: "" }, { "": pub, k1: pub }, 1)).toBeNull();
  });

  it("refuses a file whose outer version does not match the signed one", async () => {
    const text = file(3);
    expect(await verifiedRules({ version: 9, rules: text, signature: await sign(text), algorithm: "Ed25519", keyId: "k1" }, { k1: pub }, 1)).toBeNull();
  });

  it("refuses a signed file whose patterns do not compile", async () => {
    const text = file(3, "(unclosed");
    expect(await verifiedRules({ version: 3, rules: text, signature: await sign(text), algorithm: "Ed25519", keyId: "k1" }, { k1: pub }, 1)).toBeNull();
  });

  it("refuses an older signed file once a newer one is in hand (no rollback)", async () => {
    const text = file(2);
    // Newer than the bundled 1, but version 3 is already stored.
    expect(await verifiedRules({ version: 2, rules: text, signature: await sign(text), algorithm: "Ed25519", keyId: "k1" }, { k1: pub }, 3)).toBeNull();
  });
});

describe("the bundled trusted key", () => {
  it("is a 32-byte Ed25519 key filed under its keyId (the first 8 bytes, base64url)", async () => {
    const { TRUSTED_RULE_KEYS } = await import("../src/engine/trusted-keys");
    expect(Object.keys(TRUSTED_RULE_KEYS).length).toBeGreaterThan(0);
    for (const [keyId, pubB64] of Object.entries(TRUSTED_RULE_KEYS)) {
      const raw = Uint8Array.from(atob(pubB64), (c) => c.charCodeAt(0));
      expect(raw.length).toBe(32);
      const id = btoa(String.fromCharCode(...raw.slice(0, 8))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      expect(id).toBe(keyId);
      await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    }
  });
});

