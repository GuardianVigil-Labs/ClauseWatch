import { describe, expect, it, vi } from "vitest";
import { JOB_TTL_MS, MAX_JOBS, MAX_SESSION_CHARS, ScanJobs, activeJob, newJob, type JobStore, type ScanJob, type ScanPlan } from "../src/scan/jobs";
import type { KnownSite } from "../src/engine/known-sites";
import { fetchText, MAX_PDF_BYTES, NO_ROOM_REASON, type Fetched } from "../src/auto/background";
import { readFetched, scanTargets } from "../src/ui/scan";
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
  const fetch = vi.fn(async (url: string, _sites: KnownSite[], _signal: AbortSignal, _room: number): Promise<Fetched> => ({ ok: true, url, text: "document", contentType: "text/html" }));
  const allowed = vi.fn(async (_origins: string[]) => true);
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

  it("keeps the largest PDF a download allows, next to another document", async () => {
    const x = setup();
    x.fetch.mockImplementation(async (url) => url.endsWith("terms")
      ? { ok: true, url, text: "", contentType: "application/pdf", pdf: "A".repeat(Math.ceil(MAX_PDF_BYTES / 3) * 4) }
      : { ok: true, url, text: "x".repeat(256 * 1024), contentType: "text/html" });
    const job = newJob(plan(), [origin], [], "scan", 1000);
    await x.store.put(job); await x.runner.wake();
    expect(x.records.get(job.id)?.state).toBe("complete");
    expect(JSON.stringify(x.records.get(job.id)).length).toBeLessThanOrEqual(MAX_SESSION_CHARS);
  });

  // Real downloads: each PDF is served as bytes and kept as base64 by fetchText.
  const servePdfs = (size: (url: string) => number) => vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = new Uint8Array(size(url)).fill(32);
    body.set(new TextEncoder().encode("%PDF-"));
    return new Response(body, { headers: { "content-type": "application/pdf" } });
  }));
  const realFetch = (rooms: number[] = []) => async (url: string, _sites: KnownSite[], signal: AbortSignal, room: number) => { rooms.push(room); return fetchText(url, () => true, signal, room); };

  it("keeps a terms and privacy scan of two PDFs: the second gets only the room left, refused clearly when larger", async () => {
    const x = setup();
    servePdfs(() => MAX_PDF_BYTES);
    const rooms: number[] = [];
    x.fetch.mockImplementation(realFetch(rooms));
    const job = newJob(plan(), [origin], [], "scan", 1000);
    await x.store.put(job); await x.runner.wake();
    vi.unstubAllGlobals();
    const kept = x.records.get(job.id)!;
    expect(kept.state).toBe("complete");
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(MAX_SESSION_CHARS);
    expect(kept.result?.fetched?.pages["https://service.example/terms"]).toMatchObject({ ok: true, contentType: "application/pdf" });
    expect(kept.result?.fetched?.pages["https://service.example/privacy"]).toEqual({ ok: false, reason: NO_ROOM_REASON });
    expect(rooms[1]).toBeLessThan(rooms[0]! - Math.ceil(MAX_PDF_BYTES / 3) * 4);
  });

  it("keeps a second PDF exactly as large as the room left, and refuses one byte more", async () => {
    for (const extra of [0, 1]) {
      const x = setup();
      const rooms: number[] = [];
      servePdfs((url) => (url.endsWith("terms") ? MAX_PDF_BYTES : Math.floor(rooms[1]! / 4) * 3 + extra));
      x.fetch.mockImplementation(realFetch(rooms));
      const job = newJob(plan(), [origin], [], "scan", 1000);
      await x.store.put(job); await x.runner.wake();
      vi.unstubAllGlobals();
      const kept = x.records.get(job.id)!;
      expect(kept.state).toBe("complete");
      expect(JSON.stringify(kept).length).toBeLessThanOrEqual(MAX_SESSION_CHARS);
      expect(kept.result?.fetched?.pages["https://service.example/privacy"]?.ok).toBe(extra === 0);
    }
  });

  it("refuses a page that grows past the job's room when kept, instead of failing the scan", async () => {
    const x = setup();
    // Quotes are escaped when kept: the page takes twice its downloaded size.
    x.fetch.mockImplementation(async (url, _sites, _signal, room) => ({ ok: true, url, text: '"'.repeat(Math.floor(room * 0.6)), contentType: "text/html" }));
    const job = newJob(plan(), [origin], [], "scan", 1000);
    await x.store.put(job); await x.runner.wake();
    const kept = x.records.get(job.id)!;
    expect(kept.state).toBe("complete");
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(MAX_SESSION_CHARS);
    expect(kept.result?.fetched?.pages["https://service.example/terms"]).toEqual({ ok: false, reason: NO_ROOM_REASON });
    expect(kept.result?.fetched?.pages["https://service.example/privacy"]).toEqual({ ok: false, reason: NO_ROOM_REASON });
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

  it("writes an expired job once, not again on every wake while its access cannot be removed", async () => {
    const x = setup(); x.release.mockRejectedValue(new Error("busy"));
    const old = newJob(plan(), [origin], [origin], "scan", 1000); old.state = "complete";
    await x.store.put(old);
    x.setNow(1000 + JOB_TTL_MS);
    await x.runner.expire(); await x.runner.wake();
    const put = vi.spyOn(x.store, "put");
    await x.runner.expire(); await x.runner.wake();
    expect(put).not.toHaveBeenCalled();
    expect(x.records.get(old.id)?.released).toBeUndefined();
  });

  it("asks for the timer only while a job is kept, after a worker restart too", async () => {
    const x = setup();
    const pending = vi.fn(async (_any: boolean) => {});
    const runner = new ScanJobs({ ...x.io, pending });
    await runner.wake();
    expect(pending).toHaveBeenLastCalledWith(false);
    const job = newJob(plan(), [origin], [origin], "scan", 1000);
    await x.store.put(job); await runner.wake();
    expect(x.records.get(job.id)?.state).toBe("complete");
    expect(pending).toHaveBeenLastCalledWith(true);
    const restarted = new ScanJobs({ ...x.io, pending });
    await restarted.recover(); await restarted.wake();
    expect(pending).toHaveBeenLastCalledWith(true);
    x.setNow(1000 + JOB_TTL_MS); await restarted.wake();
    expect(x.records.size).toBe(0);
    expect(pending).toHaveBeenLastCalledWith(false);
  });

  it("keeps the timer for a job saved while the empty queue is clearing it", async () => {
    const x = setup(); x.allowed.mockResolvedValue(false);
    let alarm = true;
    const job = newJob(plan(), [origin], [origin], "scan", 1000);
    let late: Promise<void> | undefined;
    const runner: ScanJobs = new ScanJobs({ ...x.io, pending: async (any) => {
      if (any) { alarm = true; return; }
      // The job arrives and wakes the queue while the timer is being cleared.
      if (!late) { await x.store.put(job); late = runner.wake(); }
      alarm = false;
    } });
    await runner.wake(); await late;
    expect(x.records.get(job.id)?.state).toBe("waiting");
    expect(alarm).toBe(true);
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

describe("temporary access release", () => {
  const other = "https://other.example/*";
  const finished = (origins: string[], added: string[], state: ScanJob["state"] = "complete") => { const j = newJob(plan(), origins, added, "scan", 1000); j.state = state; return j; };

  it("releases a finished job's access while an unrelated job is still waiting", async () => {
    const x = setup(); x.allowed.mockResolvedValue(false);
    const done = finished([origin], [origin]);
    const waiting = newJob(plan("other.example"), [other], [other], "scan", 1001);
    await x.store.put(done); await x.store.put(waiting);
    await x.runner.wake();
    expect(x.release).toHaveBeenCalledExactlyOnceWith([origin]);
    expect(x.records.get(done.id)?.released).toBe(true);
    expect(x.records.get(waiting.id)?.released).toBeUndefined();
  });

  it("gives back access AI settings retired only once no active scan uses it", async () => {
    const x = setup(); x.allowed.mockResolvedValue(false);
    // The scan counted the AI address as held, so it never adds it to its own release.
    const scan = newJob(plan(), [origin], [], "scan", 1000);
    await x.store.put(scan);
    await x.runner.retire([origin]);
    expect(x.release).not.toHaveBeenCalled();
    await x.runner.cancel(scan.id);
    expect(x.release).toHaveBeenCalledExactlyOnceWith([origin]);
    await x.runner.wake();
    expect(x.release).toHaveBeenCalledTimes(1);
  });

  it("never removes access a running job uses, and still removes it after that job ends even if it counted it as held", async () => {
    const x = setup();
    const done = finished([origin], [origin]);
    const borrower = newJob(plan(), [origin], [], "scan", 1001);
    await x.store.put(done); await x.store.put(borrower);
    x.fetch.mockImplementation(async (url) => { expect(x.release).not.toHaveBeenCalled(); return { ok: true, url, text: "t", contentType: "text/html" }; });
    await x.runner.wake();
    expect(x.release).toHaveBeenCalledExactlyOnceWith([origin]);
    expect(x.records.get(done.id)?.released).toBe(true);
  });

  it("releases access when a running job is cancelled, without waiting for another job's prompt", async () => {
    const x = setup();
    const job = newJob(plan(), [origin], [origin], "scan", 1000);
    const prompt = newJob(plan("other.example"), [other], [other], "scan", 1001);
    await x.store.put(job); await x.store.put(prompt);
    x.allowed.mockImplementation(async (origins: string[]) => origins[0] === origin);
    let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    x.fetch.mockImplementation((_url, _sites, signal) => new Promise((resolve) => { entered(); signal.addEventListener("abort", () => resolve({ ok: false, reason: "cancelled" })); }));
    const running = x.runner.wake(); await started;
    await x.runner.cancel(job.id); await running;
    expect(x.release).toHaveBeenCalledExactlyOnceWith([origin]);
    expect(x.records.get(prompt.id)?.state).toBe("waiting");
  });

  it("ends a menu scan whose granted access was removed before it was saved, without fetching", async () => {
    const x = setup();
    let granted = true;
    x.allowed.mockImplementation(async () => granted);
    const done = finished([origin], [origin]);
    await x.store.put(done);
    // The menu request finds the temporary access still there and is granted.
    // The removal completes, then the job is saved and wakes the queue.
    x.release.mockImplementationOnce(async () => { granted = false; });
    await x.runner.wake();
    expect(x.records.get(done.id)?.released).toBe(true);
    const late = newJob(plan(), [origin], [origin], "menu", 1002);
    await x.store.put(late);
    await x.runner.wake();
    expect(x.records.get(late.id)?.state).toBe("waiting");
    await x.runner.wake(late.id);
    expect(x.records.get(late.id)?.state).toBe("failed");
    expect(x.records.get(late.id)?.reason).toBe("Access to this site changed while the scan was starting. Select Scan again.");
    expect(x.completed).toHaveBeenCalledOnce();
    expect(x.fetch).not.toHaveBeenCalled();
  });

  it("fails an answered scan that has no access promptly, rather than at expiry", async () => {
    const x = setup(); x.allowed.mockResolvedValue(false);
    const job = newJob(plan(), [origin], [origin], "scan", 1000);
    await x.store.put(job);
    await x.runner.wake(job.id);
    expect(x.records.get(job.id)?.state).toBe("failed");
    expect(x.records.get(job.id)?.reason).toMatch(/Select Scan again/);
    expect(x.completed).not.toHaveBeenCalled();
    expect(x.fetch).not.toHaveBeenCalled();
  });

  it("completes an answered scan that has its access", async () => {
    const x = setup();
    const job = newJob(plan(), [origin], [origin], "menu", 1000);
    await x.store.put(job);
    await x.runner.wake(job.id);
    expect(x.records.get(job.id)?.state).toBe("complete");
    expect(x.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a scan whose prompt is still open waiting until it is granted", async () => {
    const x = setup(); x.allowed.mockResolvedValue(false);
    const job = newJob(plan(), [origin], [origin], "menu", 1000);
    await x.store.put(job);
    await x.runner.wake(); await x.runner.wake();
    expect(x.records.get(job.id)?.state).toBe("waiting");
    x.allowed.mockResolvedValue(true);
    await x.runner.wake(job.id);
    expect(x.records.get(job.id)?.state).toBe("complete");
  });

  it("after a worker restart, keeps access for the recovered job and removes the rest; a failed removal is retried", async () => {
    const x = setup();
    const done = finished([other], [other]);
    const interrupted = newJob(plan(), [origin], [origin], "scan", 1001); interrupted.state = "running";
    await x.store.put(done); await x.store.put(interrupted);
    x.release.mockRejectedValueOnce(new Error("busy"));
    const restarted = new ScanJobs(x.io);
    await restarted.recover();
    x.fetch.mockImplementation(async (url) => { expect(x.release.mock.calls.flat(2)).not.toContain(origin); return { ok: true, url, text: "t", contentType: "text/html" }; });
    await restarted.wake();
    expect(x.records.get(done.id)?.released).toBeUndefined();
    await restarted.wake();
    expect(x.release).toHaveBeenLastCalledWith([other, origin]);
    expect([...x.records.values()].every((j) => j.released)).toBe(true);
  });
});

describe("immutable fetched targets", () => {
  const rules = compileRules(rulesFile as RulesFile);
  const filler = "This section explains the service and the agreement that applies to everyone using an account. ".repeat(25);
  const fetcher = async (url: string): Promise<Fetched> => ({ ok: true, url, text: `<h1>${url.includes("privacy") ? "Privacy Policy" : "Terms of Service"}</h1><p>${filler}</p>`, contentType: "text/html" });
  it("reads the original fetched URLs even if a later rules release moves them", async () => {
    const before = [{ id: "service", name: "Service", domains: ["service.example"], terms: "https://service.example/old-terms", privacy: "https://service.example/old-privacy" }];
    const targets = scanTargets("https://service.example/", "auto", before);
    const fetched = { site: "service.example", documents: [], fetched: { url: "https://service.example/", kind: "auto" as const, targets, pages: Object.fromEntries(await Promise.all(targets.map(async (t) => [t.url, await fetcher(t.url)] as const))) } };
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
