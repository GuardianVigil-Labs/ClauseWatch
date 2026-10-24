// Quote validation for AI findings. The AI may point at a
// clause; only the document can say what it says. A finding survives only
// when its quote appears word for word in the document, in a known category,
// and long enough to say something. Anything else is dropped. The AI never
// gives a grade, a score or a verdict, and nothing here would carry one.

import { foldForCheck, VERDICT } from "./verdict";

export interface AiFinding {
  category: string;
  quote: string;
  /** A plain-language explanation of what the quoted clause allows. */
  explanation: string;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (s: string) => squash(s).split(" ").filter(Boolean).length;

/** Pulls the first JSON array out of a model's answer, which may wrap it in prose or a code fence. */
export function jsonArray(raw: string): unknown[] {
  // Known limit: tries the first 20 "[" starts, each against every closing "]"; answers are short.
  let tries = 0;
  for (let start = raw.indexOf("["); start >= 0 && tries < 20; start = raw.indexOf("[", start + 1), tries++) {
    for (let end = raw.lastIndexOf("]"); end > start; end = raw.lastIndexOf("]", end - 1)) {
      try {
        const v = JSON.parse(raw.slice(start, end + 1));
        if (Array.isArray(v) && v.some((x) => typeof x === "object" && x !== null)) return v;
      } catch {
        // Not JSON at this span: try a shorter one.
      }
    }
  }
  return [];
}

/**
 * The findings that quote the document exactly. `known` are the rules file's
 * categories; `minWords` its minimum quote length; `already` the quotes the
 * rules found, so the AI adds only what they missed.
 */
export function validateAiFindings(raw: string, body: string, known: string[], minWords: number, already: string[] = []): AiFinding[] {
  const doc = squash(body);
  const seen = new Set(already.map(squash));
  const out: AiFinding[] = [];
  for (const item of jsonArray(raw)) {
    const f = item as Partial<Record<keyof AiFinding, unknown>>;
    if (typeof f?.category !== "string" || typeof f?.quote !== "string") continue;
    const quote = squash(f.quote);
    if (!known.includes(f.category) || words(quote) < minWords || !doc.includes(quote) || seen.has(quote)) continue;
    seen.add(quote);
    // An explanation that judges the service is dropped; the quote stands on its own.
    const said = typeof f.explanation === "string" ? foldForCheck(f.explanation).slice(0, 400) : "";
    const explanation = VERDICT.test(said) ? "" : said;
    out.push({ category: f.category, quote, explanation });
  }
  return out;
}
