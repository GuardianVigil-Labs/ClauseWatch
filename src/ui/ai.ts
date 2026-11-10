import type { DocumentResult } from "../engine/documents";
import type { CompiledRules } from "../engine/rules";
import { kv } from "../storage";
import { aiFindings, aiSummary, newAiAnalysis, type AiRequestOptions, type AiSettings } from "../ai/assist";
import { AI_CHUNK_CHARS, planAiCoverage } from "../ai/source";
import { topicLabel } from "./report";

const mounts = new WeakMap<HTMLElement, symbol>();
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.textContent = text; node.className = cls; return node;
};

/** Controls stay available after a failure; cancellation never starts a new request. */
export async function aiOffer(documents: DocumentResult[], panel: HTMLElement, rules: CompiledRules): Promise<void> {
  const marker = Symbol(); mounts.set(panel, marker);
  const settings = ((await kv.get("ai").catch(() => undefined)) as AiSettings | undefined) ?? { mode: "off" };
  if (settings.mode === "off" || !panel.isConnected || mounts.get(panel) !== marker) return;
  const quotes = [...new Set(documents.flatMap((d) => d.status === "read" ? d.categories.flatMap((c) => c.findings.map((f) => f.quote)) : []))];
  const sections: HTMLElement[] = [];
  const controllers = new Set<AbortController>();
  let stale = false;

  function task(label: string, run: (options: AiRequestOptions) => Promise<void>, resume = false) {
    const box = element("section", "", "ai");
    const button = element("button", label);
    const cancel = element("button", "Cancel AI request", "secondary"); cancel.hidden = true;
    const status = element("p", "", "note"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const output = element("div");
    let running: AbortController | null = null;
    let done = false;
    cancel.addEventListener("click", () => running?.abort());
    button.addEventListener("click", async () => {
      if (running || stale) return;
      const controller = new AbortController(); running = controller; controllers.add(controller);
      button.disabled = true; cancel.hidden = false; status.textContent = "Asking AI…";
      try {
        await run({ signal: controller.signal, onProgress: ({ completed, total }) => { if (box.isConnected && !stale) status.textContent = `AI batches checked: ${completed}/${total}.`; } });
        if (!stale && box.isConnected) { status.textContent += " Complete."; button.textContent = resume ? "AI analysis complete" : label; done = resume; }
      } catch (err) {
        if (!stale && box.isConnected) {
          status.textContent = `${err instanceof Error ? err.message : "AI help could not answer."} ${resume ? "Completed analysis batches are kept for retry." : "You can retry this request."}`;
          button.textContent = "Retry AI request";
        }
      } finally {
        controllers.delete(controller); running = null; cancel.hidden = true; button.disabled = stale || done;
      }
    });
    box.append(button, cancel, status, output); sections.push(box);
    return { box, button, status, output };
  }

  const summary = task("Summarise the quotes (AI)", async (options) => {
    const used = [...quotes];
    if (!used.length) { summary.output.replaceChildren(element("p", "There are no quotes to summarise.", "note")); return; }
    const sentences = await aiSummary(settings, used, options);
    if (!summary.box.isConnected || stale) return;
    const head = element("p", "AI-selected quote summary. Every item is a complete sentence copied from its cited source; generated claims are not displayed. This is a selection, not full coverage of the documents.", "ai-label");
    const list = element("ul");
    for (const sentence of sentences) {
      const item = element("li", `“${sentence.text}” `);
      const citations = element("details"); citations.append(element("summary", "Show cited quotes"));
      for (const number of sentence.quotes) citations.append(element("blockquote", `[${number}] ${used[number - 1]}`));
      item.append(citations); list.append(item);
    }
    summary.output.replaceChildren(head, sentences.length ? list : element("p", "AI returned no complete source sentences that passed validation.", "note"));
  });
  summary.box.prepend(element("p", `The summary selects at most four complete source sentences. At most ${AI_CHUNK_CHARS.toLocaleString("en-US")} quote characters are sent per batch; quotes longer than that are omitted.`, "note"));
  panel.prepend(summary.box);

  const read = documents.filter((d): d is DocumentResult & { status: "read" } => d.status === "read" && !!d.body);
  if (read.length) {
    const coverage = read.map((d) => planAiCoverage(d.body));
    const states = read.map(() => newAiAnalysis());
    const total = coverage.reduce((n, c) => n + c.chunks.length, 0);
    const results = () => {
      const items: HTMLElement[] = [];
      for (const [index, state] of states.entries()) for (const finding of state.findings) {
        if (!quotes.includes(finding.quote)) quotes.push(finding.quote);
        const item = element("section", "", "ai");
        item.append(element("p", `Found by AI (quoted) · ${topicLabel(finding.category)}`, "ai-label"), element("blockquote", `“${finding.quote}”`));
        const doc = read[index]!;
        item.append(element("p", `${doc.kind === "terms" ? "Terms" : "Privacy"}${doc.url ? ` · ${doc.url}` : " · pasted or selected text"}. AI suggests this topic; read the complete quote and its conditions.`, "note"));
        const details = element("details"); details.append(element("summary", "Show surrounding text"));
        const offset = doc.body.indexOf(finding.quote);
        details.append(element("blockquote", offset >= 0 ? doc.body.slice(Math.max(0, offset-500), offset+finding.quote.length+500) : finding.quote)); item.append(details);
        items.push(item);
      }
      analysis.output.replaceChildren(...(items.length ? items : [element("p", "No additional complete-sentence findings have passed validation.", "note")]));
    };
    const analysis = task("Look for clauses the rules missed (AI)", async (options) => {
      try {
        for (const [index, doc] of read.entries()) {
          await aiFindings(settings, doc, rules.categories, rules.minQuoteWords, { ...options, coverage: coverage[index], state: states[index], onProgress: () => options.onProgress?.({ completed: states.reduce((n, s) => n + s.completed.length, 0), total }) });
          if (stale || !analysis.box.isConnected) return;
          results();
        }
      } finally { if (!stale && analysis.box.isConnected) results(); }
    }, true);
    const notice = element("div", "", "note");
    notice.append(element("p", `AI coverage: at most ${AI_CHUNK_CHARS.toLocaleString("en-US")} source characters per request. All eligible sentences are split into ${total} sequential batches; the document is not silently cut at that limit. Cancel stops new batches. Retry resumes unfinished analysis batches.`));
    for (const [index, c] of coverage.entries()) notice.append(element("p", `${read[index]!.kind === "terms" ? "Terms" : "Privacy"}: ${c.coveredChars.toLocaleString("en-US")} of ${c.totalChars.toLocaleString("en-US")} source characters eligible in ${c.chunks.length} batches. ${c.skippedSentences ? `${c.skippedSentences} oversized sentences skipped. ` : ""}Unterminated or uncertain sentence fragments are not eligible. Coverage describes text submitted, not a guarantee that AI finds every clause.`));
    analysis.box.prepend(notice); analysis.button.disabled = total === 0;
    panel.append(analysis.box);
  }

  const changes: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changed, area) => {
    if (area !== "local" || !("ai" in changed)) return;
    stale = true; for (const controller of controllers) controller.abort();
    for (const section of sections) {
      for (const button of section.querySelectorAll("button")) button.disabled = true;
      section.querySelector('[role="status"]')!.textContent = "AI settings changed. Reopen this report to use the new settings.";
    }
  };
  browser.storage.onChanged.addListener(changes);
  const observer = new MutationObserver(() => {
    if (panel.isConnected && sections.every((box) => box.isConnected)) return;
    dispose();
  });
  const dispose = () => {
    stale = true; for (const controller of controllers) controller.abort();
    browser.storage.onChanged.removeListener(changes); observer.disconnect();
    window.removeEventListener("pagehide", dispose);
  };
  observer.observe(document, { subtree: true, childList: true });
  window.addEventListener("pagehide", dispose, { once: true });
}
