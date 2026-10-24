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
  rules: { id: string; category: string; all: string[]; none: string[] }[];
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
  rules: { id: string; category: string; all: Pattern[]; none: Pattern[] }[];
}

export interface Finding {
  category: string;
  ruleId: string;
  quote: string;
  /** Code-point offsets into the document body. */
  start: number;
  end: number;
  clauseIndex: number;
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
      seen.add(r.id);
      return { id: r.id, category: r.category, all: compile(r.id, r.all), none: compile(r.id, r.none ?? []) };
    }),
  };
}

export const ruleMatches = (rule: CompiledRules["rules"][number], sentence: string) =>
  rule.all.every((p) => p.test(sentence)) && !rule.none.some((p) => p.test(sentence));

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

/** One finding per rule per clause: the first sentence that matched. */
export function analyse(doc: Document, rules: CompiledRules): Finding[] {
  const out: Finding[] = [];
  for (const c of doc.clauses) {
    const r = Array.from(c.text);
    const spans = sentences(c.text);
    for (const rule of rules.rules) {
      for (const s of spans) {
        const sentence = r.slice(s.start, s.end).join("");
        if (sentence.split(/\s+/).filter(Boolean).length >= rules.minQuoteWords && ruleMatches(rule, sentence)) {
          out.push({ category: rule.category, ruleId: rule.id, quote: sentence, start: c.start + s.start, end: c.start + s.end, clauseIndex: c.index });
          break;
        }
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
