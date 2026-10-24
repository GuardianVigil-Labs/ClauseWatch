import { describe, it, expect, vi, afterEach } from "vitest";
import { validateSummary, buildSummaryPrompt } from "../src/ai/summary";
import { aiFindings, aiSummary } from "../src/ai/assist";

const quotes = ["We may use the content you upload to train our models.", "Any dispute will be resolved by binding arbitration."];

describe("AI summary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends only the numbered quotes", () => {
    const p = buildSummaryPrompt(quotes);
    expect(p).toContain(`[1] ${quotes[0]}`);
    expect(p).toContain(`[2] ${quotes[1]}`);
  });

  it("keeps cited sentences and cuts a verdict, an uncited sentence and an invented citation", () => {
    const raw = `Here: [
      {"text": "The service may train its models on what you upload.", "quotes": [1]},
      {"text": "Overall this service is safe to use.", "quotes": [1, 2]},
      {"text": "These are standard terms.", "quotes": [2]},
      {"text": "The service sells your data.", "quotes": []},
      {"text": "You must keep the service's secrets.", "quotes": [7]},
      {"text": "Disputes go to arbitration, not court.", "quotes": [2, 2, "1"]},
      {"text": "Nothing to worry about here.", "quotes": [1]}
    ]`;
    expect(validateSummary(raw, 2)).toEqual([
      { text: "The service may train its models on what you upload.", quotes: [1] },
      { text: "Disputes go to arbitration, not court.", quotes: [2] },
    ]);
  });

  it("finds the array despite brackets in prose, folds hidden characters, drops repeats", () => {
    const raw = `See [note] first: [{"text":"The service may train its models.","quotes":[1]},{"text":"The service may train its models.","quotes":[1]},{"text":"Uploads are s\u200Bafe.","quotes":[1]},{"text":"This is ｓａｆｅ.","quotes":[1]}] (end]`;
    expect(validateSummary(raw, 2)).toEqual([{ text: "The service may train its models.", quotes: [1] }]);
  });

  it("returns nothing for prose or broken JSON, and at most four sentences", () => {
    expect(validateSummary("This service looks fine.", 2)).toEqual([]);
    expect(validateSummary("[{", 2)).toEqual([]);
    const many = JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ text: `Clause ${i} allows sharing.`, quotes: [1] })));
    expect(validateSummary(many, 2)).toHaveLength(4);
  });

  it("AI off sends nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiSummary({ mode: "off" }, quotes)).rejects.toThrow(/off/);
    const doc = { kind: "terms" as const, status: "read" as const, url: "https://s.example/terms", readAt: "", categories: [], body: "x" };
    await expect(aiFindings({ mode: "off" }, doc, ["ai_training"], 8)).rejects.toThrow(/off/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("summarises through the user's key when allowed", async () => {
    const content = JSON.stringify([{ text: "The service may train its models on your uploads.", quotes: [1] }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })));
    const key = { mode: "key" as const, baseUrl: "https://llm.example/v1", model: "m", apiKey: "k" };
    expect(await aiSummary(key, quotes)).toEqual([{ text: "The service may train its models on your uploads.", quotes: [1] }]);
  });
});
