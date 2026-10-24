// Signed rule updates (docs/reader.md). A newer rules file is used only
// if its Ed25519 signature verifies over its exact bytes against a key built
// into this extension. Anything else keeps the bundled copy.

import { sitesProblem } from "./known-sites";
import { compileRules, type RulesFile } from "./rules";

export interface SignedRules {
  version: number;
  rules: string;
  signature: string;
  algorithm: string;
  keyId?: string;
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * The verified rules file, or null when it must not be used.
 *
 * `minVersion` is the newest version already in hand, bundled or stored: a
 * file must be newer than it, so an old signed file replayed later cannot roll
 * the rules back. The version outside the signature must match the one inside
 * it, the patterns must compile and any known sites it carries must be well
 * formed, or the file is refused.
 */
export async function verifiedRules(signed: SignedRules, trustedKeys: Record<string, string>, minVersion: number): Promise<RulesFile | null> {
  if (!signed || typeof signed !== "object") return null;
  if (signed.algorithm !== "Ed25519" || !signed.signature || !signed.keyId) return null;
  const pub = trustedKeys[signed.keyId];
  if (!pub) return null;
  try {
    const key = await crypto.subtle.importKey("raw", fromB64(pub), { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("Ed25519", key, fromB64(signed.signature), new TextEncoder().encode(signed.rules));
    if (!ok) return null;
    const file = JSON.parse(signed.rules) as RulesFile;
    if (file.version !== signed.version || !(file.version > minVersion)) return null;
    compileRules(file);
    if (file.sites !== undefined && sitesProblem(file.sites)) return null;
    return file;
  } catch {
    return null; // a malformed key, signature, file or pattern is a reason to keep what is there
  }
}
