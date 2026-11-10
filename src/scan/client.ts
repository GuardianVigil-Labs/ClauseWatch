import { FOCUS_KEY, JOB_PREFIX, activeJob, jobKey, newJob, type JobStore, type ScanJob, type ScanPlan } from "./jobs";

export const jobStore: JobStore = {
  async list() {
    const all = await browser.storage.session.get(null);
    return Object.entries(all).filter(([key]) => key.startsWith(JOB_PREFIX)).map(([, value]) => value as ScanJob);
  },
  async get(id) { return (await browser.storage.session.get(jobKey(id)))[jobKey(id)] as ScanJob | undefined; },
  put: (job) => browser.storage.session.set({ [jobKey(job.id)]: job }),
  remove: (id) => browser.storage.session.remove(jobKey(id)),
};

/**
 * Prepare before a click so the permission snapshot predates the grant. Access
 * another scan added and has not released yet is temporary, not held: the
 * jobs are read first, and the background removes access before marking a job
 * released, so a release racing this snapshot is never counted as held.
 */
export async function heldOrigins(origins: string[]): Promise<string[]> {
  const temporary = new Set((await jobStore.list().catch(() => [])).filter((j) => !j.released).flatMap((j) => j.addedOrigins));
  const held = await Promise.all(origins.map((origin) => !temporary.has(origin) && browser.permissions.contains({ origins: [origin] }).catch(() => false)));
  return origins.filter((_, i) => held[i]);
}

/** Must be called directly from a click: no await before requesting permission. */
export function requestScan(plan: ScanPlan, origins: string[], held: string[], source: ScanJob["source"]): { job: ScanJob; saved: Promise<void>; granted: Promise<boolean> } {
  const job = newJob(plan, origins, origins.filter((o) => !held.includes(o)), source);
  // Store the request before the permission prompt can close this popup.
  const saved = browser.storage.session.set({ [jobKey(job.id)]: job, [FOCUS_KEY]: job.id });
  const granted = browser.permissions.request({ origins }).catch(() => browser.permissions.contains({ origins }).catch(() => false));
  // The storage event and permission event also wake the worker if the popup closes.
  void saved.then(() => browser.runtime.sendMessage({ type: "scan:wake" })).catch(() => undefined);
  void Promise.all([saved, granted]).then(async ([, allowed]) => {
    if (!allowed) await browser.runtime.sendMessage({ type: "scan:cancel", id: job.id });
    else await browser.runtime.sendMessage({ type: "scan:wake" });
  }).catch(() => undefined);
  return { job, saved, granted };
}

export async function latestJob(): Promise<ScanJob | undefined> {
  return (await jobStore.list()).sort((a, b) => b.at - a.at)[0];
}
export { activeJob };
