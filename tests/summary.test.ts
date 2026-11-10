import { describe, it, expect, vi, afterEach } from "vitest";
import { validateSummary, buildSummaryPrompt } from "../src/ai/summary";
import { aiFindings, aiSummary } from "../src/ai/assist";

const quotes = ["We may use the content you upload to train our models only with your consent.", "Any dispute will be resolved by binding arbitration."];
const answer = (text: string, citations: unknown[] = [1]) => ({ text, quotes: citations });

describe("grounded AI summary", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends numbered source quotes and asks for complete source selections", () => {
    const prompt = buildSummaryPrompt(quotes);
    expect(prompt).toContain(`[1] ${quotes[0]}`);
    expect(prompt).toContain(`[2] ${quotes[1]}`);
    expect(prompt).toContain("Do not paraphrase");
  });
  it("keeps complete source sentences and rejects unsupported claims with real citations", () => {
    const raw = JSON.stringify([
      answer(quotes[0]!), answer("The service sells all your personal information.", [1]),
      answer("We may use the content you upload to train our models.", [1]),
      answer(quotes[1]!, [2, 2]), answer(quotes[1]!, [1]),
      answer(quotes[0]!, [1, 99]), answer(quotes[0]!, [1, "2"]),
      answer("Overall this service is safe to use.", [1, 2]), answer(quotes[0]!, []),
    ]);
    expect(validateSummary(raw, quotes)).toEqual([answer(quotes[0]!), answer(quotes[1]!, [2])]);
  });
  it("rejects negation reversal and keeps the source's actual spacing", () => {
    const source = "We do not sell your information except when you explicitly consent to the sale.";
    expect(validateSummary(JSON.stringify([answer("We sell your information.")]), [source])).toEqual([]);
    const spaced = source.replace("do not", "do  not");
    expect(validateSummary(JSON.stringify([answer(source)]), [spaced])).toEqual([answer(spaced)]);
  });
  it("parses fenced arrays, drops duplicates and look-alike or hidden-character inventions", () => {
    const raw = `See [note] first: ${JSON.stringify([answer(quotes[0]!), answer(quotes[0]!), answer("This is ｓａｆｅ."), answer(quotes[0]!.replace("consent", "con\u200Bsent"))])} (end]`;
    expect(validateSummary(raw, quotes)).toEqual([answer(quotes[0]!)]);
  });
  it("returns nothing for prose or broken JSON and keeps at most four source sentences", () => {
    expect(validateSummary("This service looks fine.", quotes)).toEqual([]);
    expect(validateSummary("[{", quotes)).toEqual([]);
    const sources = Array.from({ length: 9 }, (_, i) => `Clause ${i} allows sharing of a different named data category.`);
    expect(validateSummary(JSON.stringify(sources.map((s, i) => answer(s, [i + 1]))), sources)).toHaveLength(4);
  });
  it("AI off sends nothing", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(aiSummary({ mode: "off" }, quotes)).rejects.toThrow(/off/);
    const doc = { kind: "terms" as const, status: "read" as const, url: "https://s.example/terms", readAt: "", categories: [], body: "x" };
    await expect(aiFindings({ mode: "off" }, doc, ["ai_training"], 8)).rejects.toThrow(/off/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("validates the summary returned by the chosen service against the actual quote", async () => {
    const content = JSON.stringify([answer(quotes[0]!), answer("Your data is sold to everyone.")]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })));
    expect(await aiSummary({ mode: "key", baseUrl: "https://llm.example/v1", model: "m", apiKey: "fixture-key" }, quotes)).toEqual([answer(quotes[0]!)]);
  });
});
