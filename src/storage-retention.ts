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
