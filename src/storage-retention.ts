import type { KV } from "./storage";
/** Saved quote reports and opt-in full-text versions have separate limits. */
export async function cleanSaved(kv: KV, now = Date.now()): Promise<void> {
  const report = await kv.get("latestReport") as { at?: number } | undefined;
  if (report && (typeof report.at !== "number" || report.at > now || now-report.at >= 7*864e5)) await kv.remove("latestReport");
  const versions = await kv.get("policyVersions");
  if (!versions) return;
  if (await kv.get("policyVersionsEnabled") !== true || !Array.isArray(versions)) { await kv.remove("policyVersions"); return; }
  const kept = versions.filter(Array.isArray).map((group: { at: string }[]) => group.filter((v) => { const at=Date.parse(v?.at);return at<=now&&now-at<30*864e5; }).slice(-2)).filter((g)=>g.length).slice(-3);
  if (!kept.length) await kv.remove("policyVersions"); else if(JSON.stringify(kept)!==JSON.stringify(versions))await kv.set("policyVersions",kept);
}

const KEEP_VERSION_MS = 30 * 864e5;
export const MAX_VERSION_BODY = 100_000;
export interface PolicyVersion { url: string; kind: string; at: string; body: string }
export type VersionEdit = { type: "enable" | "clear" } | { type: "remember"; generation: number; documents: PolicyVersion[] };

const validVersion = (v: PolicyVersion) => typeof v?.body === "string" && v.body.length > 0 && v.body.length <= MAX_VERSION_BODY && typeof v.url === "string" && /^https?:/.test(v.url) && URL.canParse(v.url) && ["terms", "privacy"].includes(v.kind) && Number.isFinite(Date.parse(v.at));

/**
 * Every write to saved policy versions, including their cleanup. The
 * background runs each call in one queue; nothing else writes them. Returns
 * the previous version of each remembered document, or false when the edit is
 * refused (comparisons off, or turned off or cleared since the edit was asked).
 */
export async function applyVersionEdit(kv: KV, edit: VersionEdit | undefined, now = Date.now()): Promise<false | true | { previous: (PolicyVersion | undefined)[] }> {
  if (!edit) return false;
  const generation = Number(await kv.get("policyVersionsGeneration")) || 0;
  if (edit.type === "enable" || edit.type === "clear") {
    await kv.set("policyVersionsGeneration", generation + 1);
    if (edit.type === "clear") await kv.remove("policyVersions");
    await kv.set("policyVersionsEnabled", edit.type === "enable");
    return true;
  }
  if (edit.type !== "remember" || edit.generation !== generation || await kv.get("policyVersionsEnabled") !== true) return false;
  const docs = edit.documents;
  if (!Array.isArray(docs) || !docs.length || docs.length > 3 || !docs.every(validVersion)) return false;
  await cleanSaved(kv, now);
  const old = await kv.get("policyVersions");
  const stored = (Array.isArray(old) ? old as PolicyVersion[][] : []).filter((g) => Array.isArray(g) && g.length && now - Date.parse(g.at(-1)!.at) < KEEP_VERSION_MS);
  const previous: (PolicyVersion | undefined)[] = [];
  for (const d of docs) {
    const index = stored.findIndex((g) => g[0]?.url === d.url && g[0]?.kind === d.kind);
    const group = index < 0 ? [] : stored.splice(index, 1)[0]!;
    const last = group.at(-1);
    previous.push(last);
    if (!last || last.body !== d.body) group.push({ url: d.url, kind: d.kind, at: d.at, body: d.body });
    stored.push(group.slice(-2));
  }
  await kv.set("policyVersions", stored.slice(-3));
  return { previous };
}
