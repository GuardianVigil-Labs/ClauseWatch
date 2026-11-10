import { afterEach, describe, expect, it, vi } from "vitest";
import { aiFindings, aiSummary, AI_CANCELLED_REASON, AI_TIMEOUT_REASON, buildPrompt, newAiAnalysis, type AiSettings } from "../src/ai/assist";
import { validateAiFindings } from "../src/ai/validate";
import { AI_CHUNK_CHARS, planAiCoverage, sourceSentences } from "../src/ai/source";
import { aiEndpoint, keySettings } from "../src/ai/settings";

const settings: AiSettings = { mode: "key", baseUrl: "https://ai.example/v1", model: "fixture-model", apiKey: "fixture-credential" };
const doc = (body: string) => ({ kind: "terms" as const, status: "read" as const, url: "https://policy.example/terms", readAt: "", categories: [], body });
const raw = (quote: string) => JSON.stringify([{ category: "data_sale", quote, explanation: "The company may sell everything without conditions." }]);
const response = (content = "[]") => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { "content-type": "application/json" } });
const sentence = (length: number) => "We may process " + "x".repeat(length - "We may process .".length) + ".";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("complete AI source quotation", () => {
  it.each([
    ["We may sell your personal information to partners only if you explicitly consent.", "We may sell your personal information to partners"],
    ["We do not sell your personal information to advertising partners.", "sell your personal information to advertising partners."],
    ["We may sell personal information to partners; however, only with your explicit permission.", "We may sell personal information to partners;"],
    ["We do not sell your personal information except when you explicitly authorize that sale.", "We do not sell your personal information"],
    ["We may sell your personal information to partners. However, only with your explicit consent.", "We may sell your personal information to partners."],
  ])("rejects a fragment or omitted qualification and preserves the whole source", (body, fragment) => {
    expect(validateAiFindings(raw(fragment), body, ["data_sale"], 3)).toEqual([]);
    const found = validateAiFindings(raw(body), body, ["data_sale"], 3);
    expect(found).toEqual([{ category: "data_sale", quote: body, explanation: "" }]);
  });
  it("preserves source whitespace and unicode instead of manufacturing an exact quote", () => {
    const body = "With consent, we may sell  your personal information\n to partners in your region. 🌿 We never sell account passwords to anyone.";
    const quote = "With consent, we may sell your personal information to partners in your region.";
    expect(validateAiFindings(raw(quote), body, ["data_sale"], 8)[0]?.quote).toBe("With consent, we may sell  your personal information\n to partners in your region.");
  });
  it("keeps semicolons, decimals, abbreviations, wrapped lines and trailing qualifications together", () => {
    const body = "We charge 1.5 credits for each request, e.g. a storage request; only with consent\n from your account owner. Another policy sentence applies to accounts in your region.";
    expect(sourceSentences(body).map((s) => s.text)).toEqual([body.slice(0, body.indexOf(" Another")), body.slice(body.indexOf("Another"))]);
    expect(sourceSentences("This incomplete statement has no terminator")).toEqual([]);
  });
});

describe("AI credential boundaries", () => {
  it("requires an explicit credential for a changed host or path", () => {
    for (const base of ["https://other.example/v1", "https://ai.example/other-path"]) {
      expect(() => keySettings(settings, base, "model", "", "")).toThrow(/Choose a credential/);
      expect(keySettings(settings, base, "model", "replacement", "entered").apiKey).toBe("replacement");
      expect(keySettings(settings, base, "model", "", "saved")).toMatchObject({ apiKey: "fixture-credential", credentialEndpoint: aiEndpoint(base) });
    }
  });
  it("rejects embedded credentials and ambiguous endpoints", () => {
    for (const base of ["http://ai.example/v1", "https://user:secret@ai.example/v1", "https://ai.example/v1?key=fixture", "https://ai.example/v1#part"]) expect(() => aiEndpoint(base)).toThrow();
    expect(aiEndpoint("https://AI.example:443/v1/")).toBe(aiEndpoint("https://ai.example/v1"));
  });
  it("refuses sending a key to a destination different from its saved binding", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(aiSummary({ ...settings, credentialEndpoint: "https://old.example/chat/completions" } as AiSettings, [sentence(100)])).rejects.toThrow(/different endpoint/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("AI timeouts and cancellation", () => {
  it("times out a stalled network request and aborts its signal", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
    const operation = aiSummary(settings, [sentence(100)], { timeoutMs: 100 });
    const rejection = expect(operation).rejects.toThrow(AI_TIMEOUT_REASON);
    await vi.advanceTimersByTimeAsync(101); await rejection;
    expect((fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1].signal?.aborted).toBe(true);
  });
  it("cancels a stalled response body, and does not follow redirects with credentials", async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel })));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const operation = aiSummary(settings, [sentence(100)], { signal: controller.signal });
    const rejection = expect(operation).rejects.toThrow(AI_CANCELLED_REASON);
    await Promise.resolve(); await Promise.resolve(); controller.abort(); await rejection;
    expect(cancel).toHaveBeenCalled();
    expect((fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1]).toMatchObject({ redirect: "error", credentials: "omit" });
  });
  it("does not issue a request when already cancelled", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController(); controller.abort();
    await expect(aiFindings(settings, doc(sentence(100)), ["data_sale"], 3, { signal: controller.signal })).rejects.toThrow(AI_CANCELLED_REASON);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("times out a built-in prompt and destroys its session once", async () => {
    vi.useFakeTimers(); const destroy = vi.fn();
    vi.stubGlobal("LanguageModel", { create: async () => ({ prompt: () => new Promise(() => {}), destroy }) });
    const operation = aiSummary({ mode: "builtin" }, [sentence(100)], { timeoutMs: 100 });
    const rejection = expect(operation).rejects.toThrow(AI_TIMEOUT_REASON);
    await vi.advanceTimersByTimeAsync(101); await rejection;
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  it("destroys a built-in session that finishes creating after cancellation", async () => {
    let finish!: (session: { prompt: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }) => void;
    const prompt = vi.fn(); const destroy = vi.fn();
    vi.stubGlobal("LanguageModel", { create: () => new Promise((resolve) => { finish = resolve; }) });
    const controller = new AbortController();
    const operation = aiSummary({ mode: "builtin" }, [sentence(100)], { signal: controller.signal });
    const rejection = expect(operation).rejects.toThrow(AI_CANCELLED_REASON);
    controller.abort(); await rejection;
    finish({ prompt, destroy }); await Promise.resolve(); await Promise.resolve();
    expect(destroy).toHaveBeenCalledTimes(1); expect(prompt).not.toHaveBeenCalled();
  });
  it("rejects oversized service responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("x".repeat(270000))));
    await expect(aiSummary(settings, [sentence(100)])).rejects.toThrow(/too large/);
  });
});

describe("long document coverage and retry", () => {
  it("plans exact, bounded chunks across the entire document without cutting a sentence", () => {
    const body = Array.from({ length: 8 }, () => sentence(8000)).join("\n\n") + "\n\nWe may sell information to partners only with your explicit consent.";
    const coverage = planAiCoverage(body);
    expect(coverage.chunks.length).toBeGreaterThan(1);
    for (const chunk of coverage.chunks) {
      expect(chunk.text).toBe(body.slice(chunk.start, chunk.end));
      expect(chunk.text.length).toBeLessThanOrEqual(AI_CHUNK_CHARS);
    }
    expect(coverage.chunks.at(-1)!.text).toContain("only with your explicit consent.");
    expect(coverage.coveredChars).toBe(body.length);
    expect(() => buildPrompt(doc(body), ["data_sale"])).toThrow(/batch limit/);
  });
  it("reports oversized sentences and does not turn their suffixes into new chunks", () => {
    const body = sentence(AI_CHUNK_CHARS + 1) + "\n\n" + sentence(100);
    const coverage = planAiCoverage(body);
    expect(coverage.skippedSentences).toBe(1);
    expect(coverage.coveredChars).toBe(100);
    expect(coverage.chunks.map((c) => c.text)).toEqual([sentence(100)]);
  });
  it("does not submit omitted unterminated fragments between eligible sentences", () => {
    const body = sentence(100) + "\n\nAn unfinished fragment without punctuation\n\n" + sentence(101);
    const coverage = planAiCoverage(body);
    expect(coverage.chunks.map((c) => c.text)).toEqual([sentence(100), sentence(101)]);
    expect(coverage.coveredChars).toBe(201);
  });
  it("finds a clause past the old truncation limit and retries only unfinished batches", async () => {
    const tail = "We may sell personal information to partners only when you explicitly consent.";
    const body = sentence(16000) + "\n\n" + sentence(16001) + "\n\n" + tail;
    const fetcher = vi.fn().mockImplementationOnce(async () => response()).mockRejectedValueOnce(new Error("temporary network failure")).mockImplementation(async () => response(raw(tail)));
    vi.stubGlobal("fetch", fetcher); const state = newAiAnalysis();
    await expect(aiFindings(settings, doc(body), ["data_sale"], 8, { state })).rejects.toThrow(/temporary/);
    expect(state.completed).toEqual([0]);
    const findings = await aiFindings(settings, doc(body), ["data_sale"], 8, { state });
    expect(findings.map((f) => f.quote)).toEqual([tail]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetcher.mock.calls[2]![1].body).messages[0].content).toContain(tail);
  });
  it("remaps summary citations across batches rather than accepting a wrong global source", async () => {
    const quotes = [sentence(16000), "We may retain your records after closure only when required by applicable law." + " ".repeat(16000)];
    const exact = quotes[1]!.trim();
    const fetcher = vi.fn().mockImplementationOnce(async () => response()).mockImplementationOnce(async () => response(JSON.stringify([{ text: exact, quotes: [1] }])));
    vi.stubGlobal("fetch", fetcher);
    expect(await aiSummary(settings, quotes)).toEqual([{ text: exact, quotes: [2] }]);
  });
});
