// Recoverable scan jobs. Requests, checkpoints and results are separate per id;
// a popup is only a viewer, never the owner of a document download.
import { NO_ROOM_REASON, type Fetched } from "../auto/background";
import type { DocumentResult, Kind } from "../engine/documents";
import type { KnownSite } from "../engine/known-sites";
import type { ScanResult } from "../ui/scan";

export const FOCUS_KEY = "scan:focus";
export const JOB_PREFIX = "scan:job:";
export const JOB_TTL_MS = 10 * 60 * 1000;
export const MAX_JOBS = 8;
export const MAX_SESSION_CHARS = 2 * 1024 * 1024;
const MAX_RECOVERIES = 3;
/** Room for a page entry's own fields: its status, content type and reason. */
const PAGE_OVERHEAD = 1024;
export interface ScanPlan {
  site: string;
  url: string;
  kind: Kind | "auto";
  targets: { url: string; kind: Kind | "auto" }[];
  groups?: { kind: Kind; urls: string[] }[];
  documents: DocumentResult[];
  sites: KnownSite[];
  explicitKind?: boolean;
}
export interface ScanJob {
  id: string;
  at: number;
  updated: number;
  source: "site" | "scan" | "menu";
  state: "waiting" | "running" | "complete" | "cancelled" | "failed";
  plan: ScanPlan;
  origins: string[];
  /** Only origins absent before this request. Other jobs may borrow them. */
  addedOrigins: string[];
  released?: boolean;
  recoveries: number;
  pages: Record<string, Fetched>;
  result?: ScanResult;
  reason?: string;
}
export interface JobStore {
  list(): Promise<ScanJob[]>;
  get(id: string): Promise<ScanJob | undefined>;
  put(job: ScanJob): Promise<void>;
  remove(id: string): Promise<void>;
}
export const activeJob = (job: ScanJob) => job.state === "waiting" || job.state === "running";
export const jobKey = (id: string) => `${JOB_PREFIX}${id}`;
function clearPayload(job: ScanJob): void {
  job.pages = {};
  job.plan.documents = [];
  delete job.result;
}
/** The job as it is kept once complete: its pages move into the result. */
function completed(job: ScanJob): ScanJob {
  const { plan, pages } = job;
  return { ...job, state: "complete", pages: {}, result: { site: plan.site, documents: plan.documents, groups: plan.groups, explicitKind: plan.explicitKind, fetched: { url: plan.url, kind: plan.kind, targets: plan.targets, pages } } };
}
/** Characters the completed job takes; it must stay within MAX_SESSION_CHARS. */
const keptSize = (job: ScanJob) => JSON.stringify(completed(job)).length;
export function newJob(plan: ScanPlan, origins: string[], addedOrigins: string[], source: ScanJob["source"], now = Date.now()): ScanJob {
  return { id: crypto.randomUUID(), at: now, updated: now, source, state: "waiting", plan, origins, addedOrigins, pages: {}, recoveries: 0 };
}

interface JobIO {
  store: JobStore;
  allowed(origins: string[]): Promise<boolean>;
  release(origins: string[]): Promise<void>;
  /** `room`: characters the page may take in the job. */
  fetch(url: string, sites: KnownSite[], signal: AbortSignal, room: number): Promise<Fetched>;
  completed?(job: ScanJob): Promise<void>;
  /** Told after each pass whether any job is still kept, so a timer runs only while one is. */
  pending?(any: boolean): Promise<void>;
  now?: () => number;
}

export class ScanJobs {
  private running: Promise<void> | null = null;
  private dirty = false;
  private controllers = new Map<string, AbortController>();
  /** Waiting jobs whose permission request has finished granted. Memory only: after a worker restart they wait until expiry. */
  private answered = new Set<string>();
  /**
   * Origins AI settings no longer use, removed by releasePermissions once no
   * active job needs them. Memory only: a worker restart before then leaves
   * the access granted until the user removes it.
   */
  private retired = new Set<string>();
  private now: () => number;
  constructor(private io: JobIO) { this.now = io.now ?? Date.now; }

  /** Called once when a worker starts, before processing newly saved jobs. */
  async recover(): Promise<void> {
    await this.expire();
    for (const job of await this.io.store.list()) {
      if (job.state !== "running") continue;
      job.recoveries++;
      job.state = job.recoveries > MAX_RECOVERIES ? "failed" : "waiting";
      if (job.state === "failed") job.reason = "This scan was interrupted repeatedly. Try again.";
      await this.io.store.put(job);
    }
  }

  /** `answered`: a job whose permission request has just finished granted. */
  wake(answered?: string): Promise<void> {
    if (answered) this.answered.add(answered);
    this.dirty = true;
    if (!this.running) this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  /** Gives back access another part of the extension no longer uses, through the same queue as job access. */
  retire(origins: string[]): Promise<void> {
    for (const origin of origins) this.retired.add(origin);
    return this.wake();
  }

  /** May run while another job is fetching: expiry must not wait for its queue. */
  async expire(): Promise<void> {
    for (const job of await this.io.store.list()) {
      if (this.now() - job.at < JOB_TTL_MS) continue;
      this.controllers.get(job.id)?.abort();
      if (job.released) { await this.io.store.remove(job.id); continue; }
      const before = JSON.stringify(job);
      clearPayload(job);
      if (activeJob(job)) { job.state = "failed"; job.reason = "This scan expired. Try again."; }
      // Only a change is written: every write wakes the queue again.
      if (JSON.stringify(job) !== before) await this.io.store.put(job);
    }
  }

  async cancel(id: string): Promise<void> {
    this.controllers.get(id)?.abort();
    const job = await this.io.store.get(id);
    if (!job || !activeJob(job)) return;
    job.state = "cancelled";
    job.reason = "The scan was cancelled.";
    clearPayload(job);
    job.updated = this.now();
    await this.io.store.put(job);
    await this.wake();
  }

  private async drain(): Promise<void> {
    do {
      this.dirty = false;
      const jobs = (await this.io.store.list()).sort((a, b) => a.at - b.at);
      for (const job of jobs) {
        if (this.now() - job.at >= JOB_TTL_MS) {
          const before = JSON.stringify(job);
          clearPayload(job);
          if (activeJob(job)) {
            job.state = "failed";
            job.reason = "This scan expired. Try again and allow access to its sites.";
            job.pages = {};
            job.updated = this.now();
            await this.io.store.put(job);
          } else if (job.released) await this.io.store.remove(job.id);
          else if (JSON.stringify(job) !== before) await this.io.store.put(job);
          continue;
        }
        if (job.state !== "waiting") { this.answered.delete(job.id); continue; }
        if (await this.io.allowed(job.origins)) { this.answered.delete(job.id); await this.run(job); }
        // Granted, yet the access is gone (removed after the request found it). It can only be asked for again from a click.
        // A job whose prompt is still open is not answered yet and keeps waiting.
        else if (this.answered.delete(job.id)) await this.lostAccess(job);
      }
      await this.releasePermissions();
      await this.prune();
      // Inside the loop: a job saved while the timer is being cleared sets dirty and gets its timer back.
      await this.io.pending?.((await this.io.store.list()).length > 0);
    } while (this.dirty);
  }

  private async run(job: ScanJob): Promise<void> {
    // Cancellation may have arrived since the list was read.
    if ((await this.io.store.get(job.id))?.state !== "waiting") return;
    const controller = new AbortController();
    let expired = false;
    const deadline = setTimeout(() => { expired = true; controller.abort(); }, Math.max(0, JOB_TTL_MS - (this.now() - job.at)));
    this.controllers.set(job.id, controller);
    job.state = "running";
    job.updated = this.now();
    try {
      await this.io.store.put(job);
      const urls = [...new Set(job.plan.targets.map((t) => t.url))];
      for (const url of urls) {
        if (controller.signal.aborted) break;
        if (!job.pages[url]?.ok) {
          // Each download gets the room the job has left, less what its entry and a redirected address add.
          delete job.pages[url];
          const room = MAX_SESSION_CHARS - keptSize(job) - 2 * url.length - PAGE_OVERHEAD;
          try { job.pages[url] = room > 0 ? await this.io.fetch(url, job.plan.sites, controller.signal, room) : { ok: false, reason: NO_ROOM_REASON }; }
          catch { job.pages[url] = { ok: false, reason: "The page could not be reached. Try again." }; }
          // Escaped characters can still make a page larger kept than downloaded.
          if (keptSize(job) > MAX_SESSION_CHARS) job.pages[url] = { ok: false, reason: NO_ROOM_REASON };
        }
        if (this.now() - job.at >= JOB_TTL_MS) { expired = true; controller.abort(); }
        // Save completed downloads before moving on. Recovery reuses these pages.
        if (controller.signal.aborted) break;
        job.updated = this.now();
        if (keptSize(job) > MAX_SESSION_CHARS) throw new Error("The scan is too large to keep. Open a policy in a tab and use This site.");
        await this.makeRoom(job);
        await this.io.store.put(job);
      }
      if (controller.signal.aborted || (await this.io.store.get(job.id))?.state === "cancelled") return;
      // Keep pages once, inside the result, rather than duplicating large strings in storage.
      Object.assign(job, completed(job));
      job.updated = this.now();
      await this.makeRoom(job);
      await this.io.store.put(job);
    } catch (err) {
      if (controller.signal.aborted || (await this.io.store.get(job.id))?.state === "cancelled") return;
      job.state = "failed";
      job.pages = {};
      delete job.result;
      job.reason = err instanceof Error ? err.message : "The scan could not finish. Try again.";
      await this.io.store.put(job);
    } finally {
      clearTimeout(deadline);
      this.controllers.delete(job.id);
      if (expired) {
        const latest = await this.io.store.get(job.id);
        if (latest) { clearPayload(latest); latest.state = "failed"; latest.reason = "This scan expired. Try again."; await this.io.store.put(latest); }
      }
    }
    if (job.source === "menu") await this.io.completed?.(job);
  }

  private async makeRoom(next: ScanJob): Promise<void> {
    const jobs = (await this.io.store.list()).filter((j) => j.id !== next.id);
    let size = JSON.stringify(next).length + jobs.reduce((n, j) => n + JSON.stringify(j).length, 0);
    for (const old of jobs.filter((j) => !activeJob(j)).sort((a, b) => a.at - b.at)) {
      if (size <= MAX_SESSION_CHARS) break;
      const before = JSON.stringify(old).length;
      clearPayload(old);
      old.state = "failed";
      old.reason = "This result was cleared to make room for another scan. Try again.";
      await this.io.store.put(old);
      size -= before - JSON.stringify(old).length;
    }
    if (size > MAX_SESSION_CHARS) throw new Error("There is not enough room to keep this scan. Cancel another scan and try again.");
  }

  /**
   * The only place temporary access is removed, inside the drain queue, so a
   * job never starts or runs while its access is being removed. A finished job
   * stays unreleased while an active job uses any origin it added; the origin
   * is removed once no active job uses it. Access is removed before a job is
   * marked released, so heldOrigins never mistakes it for earlier access.
   */
  private async releasePermissions(): Promise<void> {
    const jobs = await this.io.store.list();
    const inUse = new Set(jobs.filter(activeJob).flatMap((j) => j.origins));
    const done = jobs.filter((j) => !activeJob(j) && !j.released && !j.addedOrigins.some((o) => inUse.has(o)));
    const retired = [...this.retired].filter((o) => !inUse.has(o));
    const origins = [...new Set([...done.flatMap((j) => j.addedOrigins), ...retired])];
    if (origins.length) {
      // A failed removal is retried on the next wake; the jobs stay unreleased.
      try { await this.io.release(origins); } catch { return; }
    }
    for (const origin of retired) this.retired.delete(origin);
    for (const job of done) { if (this.now() - job.at >= JOB_TTL_MS) clearPayload(job); job.released = true; await this.io.store.put(job); }
  }

  private async lostAccess(job: ScanJob): Promise<void> {
    if ((await this.io.store.get(job.id))?.state !== "waiting") return;
    job.state = "failed";
    job.reason = "Access to this site changed while the scan was starting. Select Scan again.";
    job.updated = this.now();
    await this.io.store.put(job);
    if (job.source === "menu") await this.io.completed?.(job);
  }

  private async prune(): Promise<void> {
    const jobs = (await this.io.store.list()).filter((j) => !activeJob(j) && j.released).sort((a, b) => b.at - a.at);
    for (const [index, job] of jobs.entries()) if (index >= MAX_JOBS || this.now() - job.at >= JOB_TTL_MS) await this.io.store.remove(job.id);
  }
}
