// The rules the extension runs: the signed rules, minus
// those the person switched off, plus the person's own.
//
// Signed rules run on the browser's own engine. Every unsigned rule (written
// or imported by the person) first passes the same pattern check, then runs
// on re2js, a port of RE2: linear time, so no pattern can freeze a page, and
// the same matching as Go's engine in the rule checks.

import { RE2JS } from "re2js";
import type { KV } from "../storage";
import { PATTERN_LIMITS, patternProblem } from "./pattern-check";
import type { CompiledRules } from "./rules";

export const OWN_KEY = "ownRules";
export const DISABLED_KEY = "disabledRuleIds";
export const MAX_OWN_RULES = 200;
const MAX_IMPORT_BYTES = 512 * 1024;
const MAX_EXAMPLES = 10;
const MAX_TEXT = 1000;
/** All unsigned patterns together: compiling is not free, and an imported pack is not trusted to be small. */
export const MAX_UNSIGNED_PATTERNS = 600;

// Whitespace the browser's \s matches and RE2's does not (non-breaking and
// other Unicode spaces, \v): made plain spaces before an unsigned rule tests a
// sentence, so a copied rule finds what the signed one does.
const ODD_SPACE = /[\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g;

/**
 * An unsigned pattern: checked now, compiled on re2js the first time it tests a
 * sentence, so a page with no documents to read compiles nothing.
 */
let lastIn = "";
let lastOut = "";
/** The sentence with odd spaces made plain, worked out once for all the patterns that test it. */
const plain = (s: string) => (s === lastIn ? lastOut : ((lastIn = s), (lastOut = s.replace(ODD_SPACE, " "))));

function lazyPattern(p: string, onFailure: boolean): { test(s: string): boolean } {
  let re: ReturnType<typeof RE2JS.compile> | null | false = null;
  return {
    test(s: string) {
      if (re === null) {
        try {
          re = RE2JS.compile(p, RE2JS.CASE_INSENSITIVE);
        } catch {
          re = false;
        }
      }
      // A pattern re2js cannot read fails safe: a must-match never matches, and a
      // must-not-match always does, so the rule finds nothing rather than too much.
      return re === false ? onFailure : re.test(plain(s));
    },
  };
}

/** A rule the person wrote or imported, kept only on this device. */
export interface OwnRule {
  id: string;
  title: string;
  category: string;
  all: string[];
  none: string[];
  /** Sentences it must match and must not match: checked before it is saved. */
  examples: { match: string[]; noMatch: string[] };
}

type Compiled = CompiledRules["rules"][number];

/** Compiles one unsigned rule on re2js, or says why it cannot run. */
export function compileUnsigned(r: { id: string; category: string; all: string[]; none: string[] }, known: string[], { parse = true } = {}): Compiled {
  if (!r.id || typeof r.id !== "string") throw new Error("A rule needs an id.");
  if (!known.includes(r.category)) throw new Error(`"${r.id}": unknown topic "${r.category}".`);
  if (!Array.isArray(r.all) || r.all.length === 0) throw new Error(`"${r.id}": at least one pattern must match.`);
  const none = Array.isArray(r.none) ? r.none : [];
  const compile = (ps: unknown[], onFailure: boolean) => {
    if (ps.length > PATTERN_LIMITS.patternsPerRule) throw new Error(`"${r.id}": at most ${PATTERN_LIMITS.patternsPerRule} patterns in a list.`);
    return ps.map((p) => {
      if (typeof p !== "string") throw new Error(`"${r.id}": a pattern must be text.`);
      const problem = patternProblem(p);
      if (problem) throw new Error(`"${r.id}": ${problem}`);
      // When a rule is written or imported, parsed now so a mistake is named; when
      // rules load for a page, only on first use (see lazyPattern).
      if (parse) {
        try {
          RE2JS.compile(p, RE2JS.CASE_INSENSITIVE);
        } catch {
          throw new Error(`"${r.id}": the pattern "${p.slice(0, 60)}" is not a valid regular expression.`);
        }
      }
      return lazyPattern(p, onFailure);
    });
  };
  return { id: r.id, category: r.category, all: compile(r.all, false), none: compile(none, true) };
}

const matches = (rule: Compiled, s: string) => rule.all.every((p) => p.test(s)) && !rule.none.some((p) => p.test(s));

/**
 * Whether an own rule may be saved: well formed, every pattern safe, and its
 * examples behave (each "match" sentence matches, each "no match" does not).
 * Returns the problem, or null.
 */
export function ownRuleProblem(r: OwnRule, known: string[]): string | null {
  if (!r || typeof r !== "object") return "Not a rule.";
  if (typeof r.title !== "string" || !r.title.trim() || r.title.length > 120) return "Give the rule a name (at most 120 characters).";
  const ex = r.examples;
  if (!ex || !Array.isArray(ex.match) || !Array.isArray(ex.noMatch)) return `"${r.title}": add the example sentences.`;
  if (ex.match.length < 1 || ex.noMatch.length < 1) return `"${r.title}": add at least one sentence it must match and one it must not.`;
  if (ex.match.length > MAX_EXAMPLES || ex.noMatch.length > MAX_EXAMPLES) return `"${r.title}": at most ${MAX_EXAMPLES} examples of each kind.`;
  if ([...ex.match, ...ex.noMatch].some((s) => typeof s !== "string" || !s.trim() || s.length > MAX_TEXT)) return `"${r.title}": an example is empty, not text, or too long.`;
  let rule: Compiled;
  try {
    // Named by its title in any message: the id is internal.
    rule = compileUnsigned({ ...r, id: r.title }, known);
  } catch (e) {
    return e instanceof Error ? e.message : "The rule cannot be used.";
  }
  const missed = ex.match.find((s) => !matches(rule, s));
  if (missed !== undefined) return `"${r.title}" does not match: "${missed.slice(0, 80)}"`;
  const wrong = ex.noMatch.find((s) => matches(rule, s));
  if (wrong !== undefined) return `"${r.title}" matches a sentence it must not: "${wrong.slice(0, 80)}"`;
  return null;
}

/**
 * The rule set to run. An own rule that cannot run is left out, never run
 * unchecked; an id already taken is left out too.
 */
export function mergeRules(base: CompiledRules, o: { disabled: string[]; own: OwnRule[] }): CompiledRules & { skipped: string[] } {
  const off = new Set(o.disabled);
  const rules: Compiled[] = base.rules.filter((r) => !off.has(r.id));
  const ids = new Set(base.rules.map((r) => r.id));
  const skipped: string[] = [];
  // Anything that is not a well-formed rule is left out, never allowed to stop a scan.
  const wellFormed = (r: unknown): r is OwnRule =>
    !!r && typeof r === "object" && typeof (r as OwnRule).id === "string" && Array.isArray((r as OwnRule).all);
  const unsigned = o.own.slice(0, MAX_OWN_RULES).filter(wellFormed).filter((r) => !off.has(r.id));
  let patterns = 0;
  for (const r of unsigned) {
    const count = r.all.length + (Array.isArray(r.none) ? r.none.length : 0);
    // Every pattern looked at counts, kept or not, so a long list of bad rules costs no more than good ones.
    patterns += count;
    if (ids.has(r.id) || patterns > MAX_UNSIGNED_PATTERNS) {
      skipped.push(r.id);
      continue;
    }
    try {
      rules.push(compileUnsigned(r, base.categories, { parse: false }));
      ids.add(r.id);
    } catch {
      skipped.push(r.id);
    }
  }
  // A topic with every rule switched off was not checked: it is left out, never shown as "not found".
  const categories = base.categories.filter((c) => rules.some((r) => r.category === c));
  return { ...base, categories, rules, skipped };
}

/** The rule set for this device, from the signed base and what is stored. */
export async function loadRules(kv: KV, base: CompiledRules): Promise<CompiledRules> {
  const [disabled, own] = await Promise.all([kv.get(DISABLED_KEY).catch(() => undefined), kv.get(OWN_KEY).catch(() => undefined)]);
  return mergeRules(base, {
    disabled: Array.isArray(disabled) ? disabled.filter((d): d is string => typeof d === "string") : [],
    own: Array.isArray(own) ? (own as OwnRule[]) : [], // checked one by one in mergeRules
  });
}

/** A new own rule's id: never one a signed rule could have. */
export const ownRuleId = (title: string) =>
  `own-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "rule"}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * Own rules from an imported file (a community pack). Refuses a file that is
 * too big or malformed, and any rule that would not pass the same checks as
 * one written here; nothing is kept unless every rule passes.
 */
export function parseImport(text: string, known: string[]): OwnRule[] {
  if (text.length > MAX_IMPORT_BYTES) throw new Error("The file is too large (at most 512 KB).");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const list = (data as { rules?: unknown })?.rules;
  if (!Array.isArray(list) || list.length === 0) throw new Error('The file needs a "rules" list.');
  if (list.length > MAX_OWN_RULES) throw new Error(`At most ${MAX_OWN_RULES} rules.`);
  const total = list.reduce((n: number, r) => n + (Array.isArray(r?.all) ? r.all.length : 0) + (Array.isArray(r?.none) ? r.none.length : 0), 0);
  if (total > MAX_UNSIGNED_PATTERNS) throw new Error(`At most ${MAX_UNSIGNED_PATTERNS} patterns in all.`);
  return list.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`Rule ${i + 1} is not a rule.`);
    const r = raw as Partial<OwnRule>;
    const rule: OwnRule = {
      id: ownRuleId(String(r.title ?? "")),
      title: String(r.title ?? ""),
      category: String(r.category ?? ""),
      all: Array.isArray(r.all) ? r.all : [],
      none: Array.isArray(r.none) ? r.none : [],
      examples: { match: Array.isArray(r.examples?.match) ? r.examples.match : [], noMatch: Array.isArray(r.examples?.noMatch) ? r.examples.noMatch : [] },
    };
    const problem = ownRuleProblem(rule, known);
    if (problem) throw new Error(problem);
    return rule;
  });
}

/** The person's own rules as a file to share; ids are left out, they are made anew on import. */
export const exportOwn = (rules: OwnRule[]) =>
  JSON.stringify({ format: "clausewatch-rules", version: 1, rules: rules.map(({ id: _id, ...r }) => r) }, null, 2);
