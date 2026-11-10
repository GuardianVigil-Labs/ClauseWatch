import { describe, expect, it, vi } from "vitest";
import { JOB_TTL_MS, MAX_JOBS, ScanJobs, activeJob, newJob, type JobStore, type ScanJob, type ScanPlan } from "../src/scan/jobs";
import type { KnownSite } from "../src/engine/known-sites";
import type { Fetched } from "../src/auto/background";
import { readFetched, fetchTargets } from "../src/ui/scan";
import { compileRules, type RulesFile } from "../src/engine/rules";
import rulesFile from "../rules/rules.json";

const origin = "https://service.example/*";
const plan = (site = "service.example"): ScanPlan => ({ site, url: `https://${site}/`, kind: "auto", targets: [{ url: `https://${site}/terms`, kind: "terms" }, { url: `https://${site}/privacy`, kind: "privacy" }], documents: [], sites: [] });
function setup() {
  let now = 1000;
  const records = new Map<string, ScanJob>();
  const store: JobStore = {
    list: async () => structuredClone([...records.values()]),
    get: async (id) => structuredClone(records.get(id)),
    put: async (job) => { records.set(job.id, structuredClone(job)); },
    remove: async (id) => { records.delete(id); },
  };
  const fetch = vi.fn(async (url: string, _sites: KnownSite[], _signal: AbortSignal): Promise<Fetched> => ({ ok: true, url, text: "document", contentType: "text/html" }));
  const allowed = vi.fn(async () => true);
  const release = vi.fn(async () => {});
  const completed = vi.fn(async () => {});
  const io = { store, fetch, allowed, release, completed, now: () => now };
  return { records, store, fetch, allowed, release, completed, io, runner: new ScanJobs(io), setNow: (n: number) => { now = n; } };
}

describe("independent background scans", () => {
  it("keeps overlapping requests and their results separate, releasing borrowed access only after both finish", async () => {
    const x = setup();
    const first = newJob(plan(), [origin], [origin], "scan", 1000);
    const second = newJob(plan("other.example"), [origin], [], "site", 1001);
    await x.store.put(first); await x.store.put(second);
    x.fetch.mockImplementation(async (url) => {
      expect(x.release).not.toHaveBeenCalled();
      return { ok: true, url, text: url, contentType: "text/html" };
    });
    await Promise.all([x.runner.wake(), x.runner.wake()]);
    expect(x.fetch).toHaveBeenCalledTimes(4);
    expect(x.records.get(first.id)?.result?.site).toBe("service.example");
    expect(x.records.get(second.id)?.result?.site).toBe("other.example");
    expect(first.id).not.toBe(second.id);
    expect(x.release).toHaveBeenCalledExactlyOnceWith([origin]);
    expect(x.records.get(first.id)?.released).toBe(true);
    expect(x.completed).not.toHaveBeenCalled();
  });

  it("never releases origins held before the scan", async () => {
    const x = setup();
    await x.store.put(newJob(plan(), [origin], [], "scan", 1000));
    await x.runner.wake();
    expect(x.release).not.toHaveBeenCalled();
  });

  it("waits for all permissions, then wakes when they are granted", async () => {
    const x = setup();
    x.allowed.mockResolvedValue(false);
    const job = newJob(plan(), [origin], [origin], "scan", 1000);
    await x.store.put(job); await x.runner.wake();
    expect(x.fetch).not.toHaveBeenCalled();
    expect(x.records.get(job.id)?.state).toBe("waiting");
    x.allowed.mockResolvedValue(true); await x.runner.wake();
    expect(x.records.get(job.id)?.state).toBe("complete");
  });

  it("recovers a terminated worker from saved pages without downloading successful pages again", async () => {
    const x = setup();
    const job = newJob(plan(), [origin], [origin], "scan", 1000);
    job.state = "running";
    job.pages[job.plan.targets[0]!.url] = { ok: true, url: job.plan.targets[0]!.url, text: "checkpoint", contentType: "text/html" };
    await x.store.put(job);
    const restarted = new ScanJobs(x.io);
    await restarted.recover(); await restarted.wake();
    expect(x.fetch).toHaveBeenCalledTimes(1);
    expect(x.fetch.mock.calls[0]![0]).toContain("/privacy");
    expect(x.records.get(job.id)?.result?.fetched?.pages[job.plan.targets[0]!.url]).toMatchObject({ text: "checkpoint" });
    expect(x.records.get(job.id)?.recoveries).toBe(1);
  });

  it("returns a failure after repeated interruptions rather than restarting forever", async () => {
    const x = setup();
    const job = newJob(plan(), [origin], [origin], "menu", 1000);
    job.state = "running"; job.recoveries = 3;
    await x.store.put(job); await x.runner.recover(); await x.runner.wake();
    expect(x.records.get(job.id)).toMatchObject({ state: "failed", reason: expect.stringContaining("interrupted") });
    expect(x.fetch).not.toHaveBeenCalled();
    expect(x.release).toHaveBeenCalledWith([origin]);
  });

  it("cancels a running download and never replaces cancellation with a completed result", async () => {
    const x = setup();
    const job = newJob(plan(), [origin], [origin], "scan", 1000);
    await x.store.put(job);
    let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    x.fetch.mockImplementation((_url, _sites, signal) => new Promise((resolve) => {
      entered();
      signal.addEventListener("abort", () => resolve({ ok: false, reason: "cancelled" }));
    }));
    const running = x.runner.wake(); await started;
    await x.runner.cancel(job.id); await running;
    expect(x.records.get(job.id)).toMatchObject({ state: "cancelled", pages: {} });
    expect(x.records.get(job.id)?.result).toBeUndefined();
    expect(x.fetch).toHaveBeenCalledTimes(1);
    expect(x.release).toHaveBeenCalledWith([origin]);
  });

  it("cancels a waiting scan without making a request", async () => {
    const x = setup(); x.allowed.mockResolvedValue(false);
    const job = newJob(plan(), [origin], [], "scan", 1000);
    await x.store.put(job); await x.runner.cancel(job.id);
    expect(x.records.get(job.id)?.state).toBe("cancelled");
    expect(x.fetch).not.toHaveBeenCalled();
  });

  it("keeps other documents when one fetch throws and opens menu results", async () => {
    const x = setup();
    x.fetch.mockRejectedValueOnce(new Error("broken response"));
    const job = newJob(plan(), [origin], [], "menu", 1000);
    await x.store.put(job); await x.runner.wake();
    const result = x.records.get(job.id)?.result;
    expect(result?.fetched?.pages[job.plan.targets[0]!.url]).toMatchObject({ ok: false });
    expect(result?.fetched?.pages[job.plan.targets[1]!.url]).toMatchObject({ ok: true });
    expect(x.completed).toHaveBeenCalledOnce();
  });

  it("expires waiting requests and removes old completed payloads", async () => {
    const x = setup(); x.allowed.mockResolvedValue(false);
    const waiting = newJob(plan(), [origin], [origin], "scan", 1000);
    const done = newJob(plan(), [origin], [], "scan", 1000); done.state = "complete"; done.released = true;
    await x.store.put(waiting); await x.store.put(done);
    x.setNow(1000 + JOB_TTL_MS - 1); await x.runner.wake();
    expect(activeJob(x.records.get(waiting.id)!)).toBe(true);
    x.setNow(1000 + JOB_TTL_MS); await x.runner.wake();
    expect(x.records.has(waiting.id)).toBe(false);
    expect(x.records.has(done.id)).toBe(false);
    expect(x.release).toHaveBeenCalledWith([origin]);
    await x.runner.wake(); expect(x.records.has(waiting.id)).toBe(false);
  });

  it("scrubs expired HTML even while another request blocks permission release", async () => {
    const x = setup(); x.allowed.mockResolvedValue(false);
    const old = newJob(plan(), [origin], [origin], "scan", 1000);
    old.state = "complete";
    old.plan.documents = [{ kind: "terms", status: "read", url: old.plan.url, body: "in-place private payload", categories: [], readAt: "" }];
    old.result = { site: "service.example", documents: [], fetched: { url: old.plan.url, kind: "auto", pages: { page: { ok: true, url: old.plan.url, text: "private payload", contentType: "text/html" } } } };
    const waiting = newJob(plan(), [origin], [], "scan", 1000 + JOB_TTL_MS);
    await x.store.put(old); await x.store.put(waiting);
    x.setNow(1000 + JOB_TTL_MS);
    await x.runner.expire(); await x.runner.wake();
    const retained = x.records.get(old.id)!;
    expect(retained.result).toBeUndefined(); expect(retained.pages).toEqual({}); expect(retained.plan.documents).toEqual([]);
    expect(x.release).not.toHaveBeenCalled();
    expect(x.records.has(waiting.id)).toBe(true);
  });

  it("does not checkpoint a download that finishes after the job expires", async () => {
    const x = setup();
    const job = newJob(plan(), [origin], [origin], "scan", 1000);
    x.fetch.mockImplementation(async (url) => { x.setNow(1000 + JOB_TTL_MS); return { ok: true, url, text: "expired payload", contentType: "text/html" }; });
    await x.store.put(job); await x.runner.wake();
    expect(x.records.has(job.id)).toBe(false);
    expect(x.fetch).toHaveBeenCalledTimes(1);
    expect(x.completed).not.toHaveBeenCalled();
  });

  it("bounds retained completed jobs", async () => {
    const x = setup();
    for (let i = 0; i < MAX_JOBS + 2; i++) {
      const job = newJob(plan(), [], [], "scan", 1000 + i); job.state = "complete"; job.released = true;
      await x.store.put(job);
    }
    await x.runner.wake();
    expect(x.records.size).toBe(MAX_JOBS);
  });

  it("converts storage quota failures into a retryable failure", async () => {
    const x = setup();
    const put = x.store.put;
    x.store.put = async (job) => {
      if (Object.keys(job.pages).length) throw new Error("Storage quota exceeded");
      await put(job);
    };
    const job = newJob(plan(), [origin], [origin], "scan", 1000);
    await x.store.put(job); await x.runner.wake();
    expect(x.records.get(job.id)).toMatchObject({ state: "failed", reason: "Storage quota exceeded", pages: {} });
    expect(x.release).toHaveBeenCalledWith([origin]);
  });
});

describe("immutable fetched targets", () => {
  const rules = compileRules(rulesFile as RulesFile);
  const filler = "This section explains the service and the agreement that applies to everyone using an account. ".repeat(25);
  const fetcher = async (url: string): Promise<Fetched> => ({ ok: true, url, text: `<h1>${url.includes("privacy") ? "Privacy Policy" : "Terms of Service"}</h1><p>${filler}</p>`, contentType: "text/html" });
  it("reads the original fetched URLs even if a later rules release moves them", async () => {
    const before = [{ id: "service", name: "Service", domains: ["service.example"], terms: "https://service.example/old-terms", privacy: "https://service.example/old-privacy" }];
    const fetched = await fetchTargets("https://service.example/", "auto", before, fetcher);
    const after = [{ ...before[0]!, terms: "https://service.example/new-terms", privacy: "https://service.example/new-privacy" }];
    const result = await readFetched(fetched, rules, after);
    expect(result.documents.map((d) => [d.kind, d.status, d.url])).toEqual([["terms", "read", before[0]!.terms], ["privacy", "read", before[0]!.privacy]]);
  });
  it("uses original candidate groups and preserves in-place results", async () => {
    const url = "https://service.example/terms";
    const result = await readFetched({ site: "service.example", documents: [{ kind: "privacy", status: "could_not_read", reason: "No link." }], groups: [{ kind: "terms", urls: [url + "-missing", url] }], fetched: { url, kind: "auto", targets: [], pages: { [url]: await fetcher(url) } } }, rules, []);
    expect(result.documents).toHaveLength(2);
    expect(result.documents[1]).toMatchObject({ kind: "terms", status: "read", url });
  });
});
