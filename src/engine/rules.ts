// What a clause says, by deterministic patterns from rules.json. Every finding
// is a sentence that matched, quoted exactly with its offsets. A category with
// no matching sentence is "not_found" — never "safe", never a score.

import { length, type Document } from "./document";
import type { KnownSite } from "./known-sites";
import { PATTERN_LIMITS, patternProblem } from "./pattern-check";

export interface RulesFile {
  version: number;
  flags: string;
  minQuoteWords: number;
  categories: string[];
  rules: { id: string; category: string; all: string[]; none: string[]; scope?: "assertion" }[];
  /** Known sites (rules/sites.json), signed together with the rules. */
  sites?: KnownSite[];
}

/** A compiled pattern: the browser's RegExp for signed rules, re2js for unsigned ones (rule-set.ts). */
export interface Pattern {
  test(sentence: string): boolean;
}

export interface CompiledRules {
  version: number;
  minQuoteWords: number;
  categories: string[];
  rules: { id: string; category: string; all: Pattern[]; none: Pattern[]; scope?: "assertion" }[];
  skipped?: string[];
  /** The person's choices (set by mergeRules), kept so a language pack can apply them too. */
  disabled?: string[];
  own?: CompiledRules["rules"];
}

export interface Finding {
  category: string;
  ruleId: string;
  quote: string;
  /** Code-point offsets into the document body. */
  start: number;
  end: number;
  clauseIndex: number;
  matchKind?: "sentence" | "list";
  /** Exact surrounding document text, retained even when cached without the body. */
  context?: { text: string; start: number; end: number };
}

export interface CategoryResult {
  category: string;
  status: "found" | "not_found";
  findings: Finding[];
}

/** Compiles a rules file, refusing what the published contract forbids. */
export function compileRules(file: RulesFile): CompiledRules {
  if (file.flags !== "i" || !(file.minQuoteWords >= 1) || !file.categories?.length || !file.rules?.length) {
    throw new Error("rules: flags must be \"i\" and minQuoteWords, categories and rules must be set");
  }
  const known = new Set(file.categories);
  const seen = new Set<string>();
  if (file.rules.length > PATTERN_LIMITS.rules) throw new Error(`rules: at most ${PATTERN_LIMITS.rules} rules`);
  const compile = (id: string, ps: string[]) => {
    if (ps.length > PATTERN_LIMITS.patternsPerRule) throw new Error(`rules: ${id}: at most ${PATTERN_LIMITS.patternsPerRule} patterns in a list`);
    return ps.map((p) => {
      const problem = patternProblem(p);
      if (problem) throw new Error(`rules: ${id}: ${problem}`);
      return new RegExp(p, file.flags);
    });
  };
  return {
    version: file.version,
    minQuoteWords: file.minQuoteWords,
    categories: file.categories,
    rules: file.rules.map((r) => {
      if (!r.id || seen.has(r.id) || !known.has(r.category) || !r.all?.length) {
        throw new Error(`rules: rule "${r.id}" needs a unique id, a known category and at least one pattern`);
      }
      if (r.scope !== undefined && r.scope !== "assertion") throw new Error(`rules: ${r.id}: unknown match scope`);
      seen.add(r.id);
      return { id: r.id, category: r.category, scope: r.scope, all: compile(r.id, r.all), none: compile(r.id, r.none ?? []) };
    }),
  };
}

const rawMatches = (rule: CompiledRules["rules"][number], text: string) =>
  rule.all.every((p) => p.test(text)) && !rule.none.some((p) => p.test(text));

/** Split only explicit contrasts after a denial; the full sentence remains the quote. */
export function assertions(sentence: string): string[] {
  if (!/\bnot\b|\bnever\b|\bcannot\b|\b(?:don|doesn|won|can)['’]t\b/i.test(sentence)) return [sentence];
  const parts: string[] = [];
  let start = 0;
  for (const separator of sentence.matchAll(/\b(?:but|however|yet|except(?:\s+that)?)\b|\band\s+(we|our\s+company)\b/gi)) {
    parts.push(sentence.slice(start, separator.index));
    start = separator.index + separator[0].length - (separator[1]?.length ?? 0);
  }
  parts.push(sentence.slice(start));
  return parts.map((s) => s.trim()).filter(Boolean);
}

export const ruleMatches = (rule: CompiledRules["rules"][number], sentence: string) =>
  rawMatches(rule, sentence) || (rule.scope === "assertion" && assertions(sentence).some((part) => rawMatches(rule, part)));

export const quoteWords = (text: string) => text.split(/\s+/).filter(Boolean).length;
export const DEFAULT_MIN_QUOTE_WORDS = 8;
/** Shared by real scanning and custom-rule example validation. */
function sentenceText(text: string): { text: string; start: number; end: number; words: number }[] {
  const points = Array.from(text);
  return sentences(text).map((span) => {
    const value = points.slice(span.start, span.end).join("");
    return { ...span, text: value, words: quoteWords(value) };
  });
}
export function matchingSentences(text: string, rule: CompiledRules["rules"][number], minWords: number): { text: string; start: number; end: number }[] {
  return sentenceText(text).filter((span) => span.words >= minWords && ruleMatches(rule, span.text));
}

/**
 * Sentences in a clause, as code-point spans. A sentence ends at ".", "!",
 * "?" or ";" followed by a space or the end, and at a line break.
 */
export function sentences(text: string): { start: number; end: number }[] {
  const r = Array.from(text);
  const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
  const out: { start: number; end: number }[] = [];
  const trimmed = (a: number, b: number) => {
    while (a < b && isSpace(r[a])) a++;
    while (b > a && isSpace(r[b - 1])) b--;
    return { start: a, end: b };
  };
  let start = 0;
  for (let i = 0; i < r.length; i++) {
    const c = r[i];
    if (c === "\n" || ((c === "." || c === "!" || c === "?" || c === ";") && (i + 1 === r.length || isSpace(r[i + 1])))) {
      out.push(trimmed(start, i + 1));
      start = i + 1;
    }
  }
  if (start < r.length) out.push(trimmed(start, r.length));
  return out.filter((s) => s.end > s.start);
}

/** Exclusion lists must never become a positive permission by combining their items. */
function positiveListIntro(text: string): boolean {
  if (!text.trimEnd().endsWith(":")) return false;
  const last = assertions(text).at(-1) ?? text;
  return !/\b(no|not|never|except|excluding|exclude|avoid|without|prohibit|forbid)\b/i.test(last.replace(/\bnot\s+limited\s+to\b/gi, ""));
}

/** Every matching sentence per rule, with exact offsets and bounded neighbouring context. */
export function analyse(doc: Document, rules: CompiledRules): Finding[] {
  const out: Finding[] = [];
  const body = Array.from(doc.body);
  for (let ci = 0; ci < doc.clauses.length; ci++) {
    const clause = doc.clauses[ci]!;
    const points = Array.from(clause.text);
    const spans = sentenceText(clause.text);
    for (const rule of rules.rules) {
      const matches = spans.filter((span) => span.words >= rules.minQuoteWords && ruleMatches(rule, span.text)).map((s) => ({ text: s.text, start: s.start, end: s.end, matchKind: "sentence" as "sentence" | "list" }));
      if (!matches.length) {
        for (let i = 1; i < spans.length; i++) {
          const before = spans[i - 1]!;
          const item = spans[i]!;
          const intro = points.slice(before.start, before.end).join("").trimEnd();
          const text = points.slice(before.start, item.end).join("");
          if (positiveListIntro(intro) && length(intro) <= 400 && length(text) <= 1200 && quoteWords(text) >= rules.minQuoteWords && ruleMatches(rule, text)) matches.push({ text, start: before.start, end: item.end, matchKind: "list" });
        }
      }
      const previous = doc.clauses[ci - 1];
      if (!matches.length && previous && positiveListIntro(previous.text) && length(previous.text) <= 400 && length(clause.text) <= 800) {
        const text = body.slice(previous.start, clause.start + length(clause.text)).join("");
        if (quoteWords(text) >= rules.minQuoteWords && ruleMatches(rule, text)) matches.push({ text, start: previous.start - clause.start, end: length(clause.text), matchKind: "list" });
      }
      for (const sentence of matches) {
        const start = clause.start + sentence.start;
        const end = clause.start + sentence.end;
        // Include adjacent paragraphs/list items as evidence, never as synthetic matches.
        const contextStart = Math.max(doc.clauses[Math.max(0, ci - 1)]!.start, start - 700);
        const next = doc.clauses[Math.min(doc.clauses.length - 1, ci + 1)]!;
        const contextEnd = Math.min(next.start + length(next.text), end + 700);
        out.push({ category: rule.category, ruleId: rule.id, quote: sentence.text, start, end, clauseIndex: clause.index, matchKind: sentence.matchKind,
          context: { text: body.slice(contextStart, contextEnd).join(""), start: contextStart, end: contextEnd } });
      }
    }
  }
  return out;
}

export function byCategory(findings: Finding[], rules: CompiledRules): CategoryResult[] {
  return rules.categories.map((category) => {
    const f = findings.filter((x) => x.category === category);
    return { category, status: f.length ? "found" : "not_found", findings: f };
  });
}

export { length };
