// Per-site quiet: sites the person asked ClauseWatch not to
// show its card on. Kept on the device.

import type { KV } from "../storage";

export const MUTED_KEY = "mutedSites";
const MAX_MUTED = 500;

export async function mutedSites(kv: KV): Promise<string[]> {
  const v = await kv.get(MUTED_KEY).catch(() => undefined);
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

export async function isMuted(kv: KV, site: string): Promise<boolean> {
  return (await mutedSites(kv)).includes(site);
}

export async function mute(kv: KV, site: string): Promise<void> {
  const list = await mutedSites(kv);
  if (!list.includes(site)) await kv.set(MUTED_KEY, [site, ...list].slice(0, MAX_MUTED));
}

export async function unmute(kv: KV, site: string): Promise<void> {
  await kv.set(MUTED_KEY, (await mutedSites(kv)).filter((s) => s !== site));
}

/** Whether the sign-up card shows: not on a muted site, and not on one shown recently (the icon shows a dot). */
export function shouldShowCard(o: { muted: boolean; checkedRecently: boolean }): boolean {
  return !o.muted && !o.checkedRecently;
}
