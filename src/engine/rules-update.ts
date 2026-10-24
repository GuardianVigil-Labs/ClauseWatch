// Fetching signed rule updates. Rules and known sites are
// public and the same for everyone. Each signed release of this repository
// carries rules.signed.json on GitHub;
// the extension fetches the latest one from there, once a day, and nothing
// else. Whoever serves the file, only the keys in trusted-keys.ts are trusted.
//
// What is stored is the signed response itself, and it is verified again every
// time it is used: a stored copy that was altered, or that an extension update
// has overtaken with a newer bundled file, is simply not used.

import type { KV } from "../storage";
import type { RulesFile } from "./rules";
import { TRUSTED_RULE_KEYS } from "./trusted-keys";
import { verifiedRules, type SignedRules } from "./verify";

/**
 * The latest release's signed file. GitHub answers with a redirect to the
 * release's own address, then to its file storage: both hosts are the
 * extension's only required host permissions (wxt.config.ts).
 */
export const RULES_URL = "https://github.com/GuardianVigil-Labs/ClauseWatch/releases/latest/download/rules.signed.json";
const STORED = "rules:update";
const CHECKED_AT = "rules:checkedAt";
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 10_000;

/** The rules to use: the stored update when it still verifies, the bundled file otherwise. */
export async function currentRulesFile(kv: KV, bundled: RulesFile, keys = TRUSTED_RULE_KEYS): Promise<RulesFile> {
  const stored = (await kv.get(STORED).catch(() => undefined)) as SignedRules | undefined;
  const update = stored ? await verifiedRules(stored, keys, bundled.version) : null;
  // A release without `sites` keeps the bundled list.
  return update ? { ...update, sites: update.sites ?? bundled.sites } : bundled;
}

/**
 * Fetches the rules once a day and keeps a newer file that verifies. Any
 * failure — offline, an error status, an oversized or malformed body, a bad
 * signature, an old version — keeps what is there. Returns whether an update
 * was stored.
 */
export async function refreshRules(
  kv: KV,
  bundled: RulesFile,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
  keys = TRUSTED_RULE_KEYS,
  url = RULES_URL,
): Promise<boolean> {
  const checkedAt = Number(await kv.get(CHECKED_AT)) || 0;
  if (now - checkedAt < CHECK_EVERY_MS) return false;

  let signed: SignedRules;
  try {
    const res = await fetchFn(url, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(TIMEOUT_MS) });
    // GitHub answered: count today as checked, whatever it said, so a missing
    // release is not asked for again every few minutes.
    await kv.set(CHECKED_AT, now);
    if (!res.ok) return false;
    // An answer that says it is too large is refused before it is read.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return false;
    const text = await res.text();
    if (text.length > MAX_BYTES) return false;
    signed = JSON.parse(text) as SignedRules;
  } catch {
    return false; // offline or timed out: retried on the next tick
  }

  const inHand = Math.max(bundled.version, (await currentRulesFile(kv, bundled, keys)).version);
  if (!(await verifiedRules(signed, keys, inHand))) return false;
  await kv.set(STORED, signed);
  return true;
}
