import { afterEach, describe, expect, it, vi } from "vitest";
import { heldOrigins, requestScan } from "../src/scan/client";
import { FOCUS_KEY, JOB_PREFIX, jobKey, type ScanPlan } from "../src/scan/jobs";

const plan: ScanPlan = { site: "service.example", url: "https://service.example/terms", kind: "terms", targets: [{ url: "https://service.example/terms", kind: "terms" }], documents: [], sites: [] };
const kept = "https://service.example/*";
const temporary = "https://legal.service.example/*";
afterEach(() => vi.unstubAllGlobals());

describe("scan permission handoff", () => {
  it("records previous access, saves a unique request before prompting, and focuses its own result", async () => {
    const order: string[] = [];
    const set = vi.fn(async () => { order.push("save"); });
    const request = vi.fn(async () => { order.push("prompt"); return true; });
    const send = vi.fn(async () => true);
    vi.stubGlobal("browser", { storage: { session: { set } }, permissions: { contains: vi.fn(async ({ origins }: { origins: string[] }) => origins[0] === kept), request }, runtime: { sendMessage: send } });
    const held = await heldOrigins([kept, temporary]);
    const first = requestScan(plan, [kept, temporary], held, "site");
    // Request must already have started, without waiting for the save promise.
    expect(order).toEqual(["save", "prompt"]);
    await first.saved; await first.granted;
    expect(first.job.addedOrigins).toEqual([temporary]);
    expect(set).toHaveBeenCalledWith({ [jobKey(first.job.id)]: first.job, [FOCUS_KEY]: first.job.id });
    const second = requestScan(plan, [kept], held, "scan");
    await second.saved;
    expect(first.job.id).not.toBe(second.job.id);
    expect(jobKey(second.job.id).startsWith(JOB_PREFIX)).toBe(true);
    expect(second.job.addedOrigins).toEqual([]);
  });

  it("cancels its own request when access is denied", async () => {
    const send = vi.fn(async () => true);
    vi.stubGlobal("browser", { storage: { session: { set: vi.fn(async () => {}) } }, permissions: { request: vi.fn(async () => false) }, runtime: { sendMessage: send } });
    const pending = requestScan(plan, [kept], [], "scan");
    await pending.granted;
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "scan:cancel", id: pending.job.id }));
  });
});
