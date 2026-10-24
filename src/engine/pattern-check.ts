// Which rule patterns may run. Browser JavaScript matches regular
// expressions by backtracking, so a pattern like `(a+)+` or `\w*\w*\w*x` can
// freeze a tab on a long terms page; Go's RE2 never backtracks, so the same
// pattern passes there. Every pattern passes this check before it compiles.
// It is a careful filter of the shapes known to backtrack badly, not a proof:
// official rules are also timed against hostile text in the tests, and rules
// people write themselves must also run under a time limit or a linear-time
// engine. It applies to the official rules and to the user's own
// rules. The rules:
//
//   - no lookaround, inline flags, special groups (anything starting "(?"),
//     no backreferences and no escapes the two engines read differently
//     (only \s \S \w \W \d \D \b \B \n \t \r \f \v and escaped symbols), and
//     class ranges only inside printable ASCII;
//   - no class starting with "]" ("[]", "[^]"): the engines read it differently;
//   - a group may be repeated more than once only if it holds no quantifier
//     and no alternation, so nothing is nested;
//   - an open-ended repeat (`*`, `+`, `{n,}`) is not allowed on `.` or a
//     negated class; those need a bound, at most {0,200};
//   - repeats that can match the same characters one after another multiply
//     the work. Each repeat is checked against the repeats before it that
//     nothing has separated it from; a required character neither can match
//     separates them. Two open-ended ones may never meet (an open-ended one
//     may follow at most four choices), except a greedy `\w`
//     repeat at the very end of the pattern, where nothing after it can fail
//     and send the engine back. Alternatives that can start with the same
//     character count as that many choices. Bounded ones (an optional piece counts as two choices,
//     {0,50} as 51) may meet only while the product of their choices stays at
//     or under 1,000, or 3,000 when a group of alternatives ends the chain
//     (so `[^.]{0,50} word [^.]{0,50}` is fine and `a{0,50}\w{0,50}!` is not);
//   - patterns are at most 400 characters.

export const PATTERN_LIMITS = { length: 400, maxRepeat: 200, patternsPerRule: 8, rules: 500, chainCost: 3_000, repeatChainCost: 1_000 } as const;

// Characters standing in for each kind of text, to tell whether two pieces of
// a pattern can match the same character: all of printable ASCII, and more.
const SAMPLE = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), "\t", "\n", "\r", "\f", "\v", "\u00a0", "\u00e9", "\u2019", "\u201c"];

// Each pattern's own characters, and a few common in legal text, are added to
// the sample, so a literal like "—" is never invisible.
const EXTRA = ["–", "—", "§", "©", "�"];

/** Which alphabet characters a single-character piece of pattern matches. */
function charSet(source: string, alphabet: string[]): Set<number> {
  const re = new RegExp(`^(?:${source})$`, "i");
  const out = new Set<number>();
  alphabet.forEach((ch, i) => { if (re.test(ch)) out.add(i); });
  return out;
}

const overlaps = (a: Set<number>, b: Set<number>) => [...a].some((x) => b.has(x));
const union = (a: Set<number>, b: Set<number>) => new Set([...a, ...b]);

interface Wide { set: Set<number>; cost: number; divided?: boolean }
// `complex`: holds a quantifier or alternation; `any`: holds "." or a negated class.
// `pre`: the current branch's leading literal text; `prefixes`/`branchFirsts`
// tell which alternatives can match at the same place.
interface Group { entry: Wide[]; branches: Wide[][]; complex: boolean; any: boolean; chars: Set<number>; firsts: Set<number>; cur: Set<number>; branchFirsts: Set<number>[]; pre: string; preOpen: boolean; prefixes: string[]; seeking: boolean; outerSeeking: Group[] }

/** Why a pattern may not run, or null when it may. */
export function patternProblem(p: string): string | null {
  if (typeof p !== "string" || p.length === 0) return "a pattern must be a non-empty string";
  if (p.length > PATTERN_LIMITS.length) return `a pattern may be at most ${PATTERN_LIMITS.length} characters`;
  try {
    new RegExp(p, "i");
  } catch {
    return "the pattern does not compile";
  }

  const alphabet = [...new Set([...SAMPLE, ...EXTRA, ...p])];
  const word = charSet("\\w", alphabet);
  const groups: Group[] = [];
  // Wide repeats that nothing has separated from what comes next.
  let pending: Wide[] = [];
  // The piece the next quantifier applies to.
  // `set` is what the piece can match; `first` what it can start with, which
  // is what meets the repeats before it.
  let atom: { kind: "char" | "dot" | "negclass" | "group"; set: Set<number>; first: Set<number>; complex: boolean; any?: boolean; literal?: boolean; entry?: Wide[]; before: Wide[]; ended: Group[] } | null = null;

  // A required run of literal characters between two repeats: text can only
  // line that word up so often, so it divides what the repeats multiply by
  // its smallest period ("sell" 4, "abab" 2, "aaaa" 1: a run that repeats
  // itself lines up almost everywhere).
  let run = "";
  const endRun = () => {
    const period = smallestPeriod(run);
    // Once per repeat: more literal runs after the first divide nothing more.
    if (period >= 2) pending = pending.map((w) => (w.cost === Infinity || w.divided ? w : { set: w.set, cost: Math.max(1, Math.ceil(w.cost / period)), divided: true }));
    run = "";
  };
  const closePrefixes = () => { for (const g of groups) g.preOpen = false; };

  // Each open group collects what it can match, and what it can start with
  // until a piece that is not optional has been read.
  const addChars = (s: Set<number>) => {
    const ended: Group[] = [];
    for (const g of groups) {
      g.chars = union(g.chars, s);
      if (g.seeking) { g.firsts = union(g.firsts, s); g.cur = union(g.cur, s); g.seeking = false; ended.push(g); }
    }
    return ended;
  };
  // A required piece: it ends every pending wide repeat it cannot overlap.
  const separate = (s: Set<number>) => { pending = pending.filter((w) => overlaps(w.set, s)); };

  for (let i = 0; i < p.length; i++) {
    const c = p.charAt(i);
    let piece: { source: string; kind: "char" | "dot" | "negclass" } | null = null;

    if (c === "\\") {
      const n = p[i + 1];
      if (n === undefined) return "a pattern may not end with a backslash";
      if (/[1-9]/.test(n) || n === "k") return "backreferences are not allowed";
      // Escapes the two engines read differently (\A, \z, \p{..}, \Q, \u, \0, ...).
      if (/[a-zA-Z0-9]/.test(n) && !"sSwWdDbBntrfv".includes(n)) return `the escape \\${n} is not allowed`;
      i++;
      if (n === "b" || n === "B") { atom = null; continue; } // a word boundary matches no character (and ends no run)
      piece = { source: `\\${n}`, kind: "char" };
    } else if (c === "[") {
      const negated = p[i + 1] === "^";
      let j = i + 1 + (negated ? 1 : 0);
      // JavaScript reads "[]" as nothing and "[^]" as anything; Go reads a "]"
      // there as the start of the class. Refuse both readings.
      if (p[j] === "]") return "write a literal ] in a character class as \\]";
      for (; j < p.length && p[j] !== "]"; j++) if (p[j] === "\\") j++;
      if (j >= p.length) return "unclosed character class";
      // A range must stay inside printable ASCII, all of which is sampled.
      const body = p.slice(i + 1 + (negated ? 1 : 0), j);
      // Ranges use plain printable characters at both ends: no escapes.
      for (let k = 0; k < body.length; k++) {
        const escaped = body[k] === "\\";
        if (escaped) {
          const n = body[k + 1] ?? "";
          if (/[a-zA-Z0-9]/.test(n) && !"sSwWdDntrfv".includes(n)) return `the escape \\${n} is not allowed`;
        }
        const next = k + (escaped ? 2 : 1);
        if (body[next] === "-" && next + 1 < body.length) {
          const hi = body[next + 1]!;
          if (escaped || hi === "\\") return "a range in a class must use plain printable characters at both ends";
          const ends = [body.codePointAt(k)!, hi.codePointAt(0)!];
          if (ends.some((x) => x < 0x20 || x > 0x7e)) return "a range in a class must stay inside printable ASCII";
          k = next + 1;
          continue;
        }
        if (escaped) k++;
      }
      piece = { source: p.slice(i, j + 1), kind: negated ? "negclass" : "char" };
      i = j;
    } else if (c === "(") {
      if (p[i + 1] === "?") return "lookaround, inline flags and special groups are not allowed";
      endRun();
      closePrefixes();
      groups.push({ entry: pending, branches: [], complex: false, any: false, chars: new Set(), firsts: new Set(), cur: new Set(), branchFirsts: [], pre: "", preOpen: true, prefixes: [], seeking: true, outerSeeking: groups.filter((g) => g.seeking) });
      atom = null;
      continue;
    } else if (c === ")") {
      endRun();
      const g = groups.pop();
      if (!g) return "unbalanced parentheses";
      g.branches.push(pending);
      g.branchFirsts.push(g.cur);
      g.prefixes.push(g.pre);
      closePrefixes();
      // After the group, what is pending is whatever any branch left pending.
      pending = dedupe(g.branches.flat());
      // Alternatives that can match at the same place are tried one after
      // another: the group multiplies the work by how many can. Two can when
      // their first characters overlap and one's leading literal text is a
      // prefix of the other's ("post" and "posts", not "post" and "publish").
      const together = (a: number, b: number) =>
        overlaps(g.branchFirsts[a]!, g.branchFirsts[b]!) && (g.prefixes[a]!.startsWith(g.prefixes[b]!) || g.prefixes[b]!.startsWith(g.prefixes[a]!));
      // A branch that matches no character (empty, or only \b, ^, $) can be
      // taken anywhere: it goes with every other branch, and the group may
      // let what came before run on past it.
      const empty = (a: number) => g.branchFirsts[a]!.size === 0;
      const choices = Math.max(1, ...g.prefixes.map((_, a) => g.prefixes.filter((_, b) => empty(a) || empty(b) || together(a, b)).length));
      const canBeEmpty = g.branchFirsts.some((b) => b.size === 0);
      if (canBeEmpty) pending = dedupe([...pending, ...g.entry]);
      if (choices > 1) {
        // What it multiplies is what came before the group, not what is inside it.
        const meets = g.entry.filter((w) => overlaps(w.set, g.firsts));
        const before = meets.reduce((m, w) => Math.max(m, w.cost), 1);
        const cost = choices * before;
        if (meets.length && cost > PATTERN_LIMITS.chainCost) return `alternatives and repeats in a row that can match the same characters multiply; keep the product of their choices at or under ${PATTERN_LIMITS.chainCost.toLocaleString("en-US")}`;
        const set = canBeEmpty ? meets.reduce((u, w) => union(u, w.set), g.chars) : g.chars;
        pending = dedupe([...pending.filter((w) => !meets.includes(w)), { set, cost }]);
      }
      const complex = g.complex || g.branches.length > 1;
      // What is inside a group is also inside every group around it.
      for (const outer of groups) { outer.complex ||= complex; outer.any ||= g.any; }
      atom = { kind: "group", set: g.chars, first: g.firsts, complex, any: g.any, entry: g.entry, before: g.entry, ended: g.outerSeeking };
      continue;
    } else if (c === "|") {
      const g = groups.at(-1);
      endRun();
      if (g) {
        g.branches.push(pending);
        g.branchFirsts.push(g.cur);
        g.cur = new Set();
        g.prefixes.push(g.pre);
        g.pre = "";
        closePrefixes();
        g.preOpen = true;
        pending = g.entry;
        for (const outer of groups) outer.complex = true;
        g.seeking = true;
        // A new branch starts where the group starts: what was a first
        // character for the groups around it still is.
        for (const og of g.outerSeeking) if (groups.includes(og)) og.seeking = true;
      } else {
        pending = []; // top-level branches are separate patterns
      }
      atom = null;
      continue;
    } else if (c === "^" || c === "$") {
      endRun();
      atom = null;
      continue;
    } else {
      const q = quantifier(p, i);
      if (q) {
        if (q.max === -2) return "invalid repeat";
        if (atom === null) return "a quantifier must follow something it can repeat";
        if (q.max !== -1 && q.max > PATTERN_LIMITS.maxRepeat) return `a bounded repeat may be at most {0,${PATTERN_LIMITS.maxRepeat}}`;
        const repeats = q.max === -1 || q.max > 1;
        if (repeats && atom.kind === "group" && atom.complex) return "a repeated group may not contain a quantifier or alternation";
        if (q.max === -1 && (atom.kind === "dot" || atom.kind === "negclass" || atom.any)) return "\".\" and negated classes need a bounded repeat, such as {0,120}";
        for (const outer of groups) outer.complex = true;

        // A repeated or optional literal ends the run (and is not part of it if optional).
        if (atom.literal) {
          if (q.min === 0) {
            run = run.slice(0, -1);
            const top = groups.at(-1);
            if (top?.preOpen) top.pre = top.pre.slice(0, -1);
          }
          endRun();
        }
        closePrefixes();
        // The piece was counted as required when it was read; undo that if it may be skipped.
        if (q.min === 0) {
          pending = atom.kind === "group" ? dedupe([...pending, ...(atom.entry ?? [])]) : dedupe([...pending, ...atom.before]);
          for (const og of atom.ended) if (groups.includes(og)) og.seeking = true; // an optional piece does not end the search
        }
        // How many lengths the repeat can take: what it multiplies by.
        const bound = q.max === -1 ? Infinity : q.max - q.min + 1;
        // At the very end, a greedy repeat of word characters is followed only by
        // word boundaries it always satisfies, so nothing sends the engine back.
        const tail = bound === Infinity && p[q.end + 1] !== "?" && atom.kind === "char" && atom.set.size === word.size && [...atom.set].every((x) => word.has(x)) && atTail(p, q.end + 1);
        if (bound > 1 && !tail) {
          const meets = pending.filter((w) => overlaps(w.set, atom!.first));
          const before = meets.reduce((m, w) => Math.max(m, w.cost), 1);
          // An open-ended repeat may follow a few choices (at most 4: `(do|don't)\s+`),
          // never another open-ended repeat or a wide bounded one.
          if (meets.length && (before === Infinity || (bound === Infinity && before > 4))) {
            return "two open-ended repeats that can match the same characters need something between them that neither can match";
          }
          const cost = bound * before;
          // A chain that ends in a repeat backtracks through every split of the
          // text between its repeats at each start (`a{0,50}\w{0,50}!` is 2,500
          // per character), so it has a lower limit than one ending in a group
          // of alternatives, which a bundled rule needs.
          if (meets.length && bound !== Infinity && cost > PATTERN_LIMITS.repeatChainCost) return `repeats in a row that can match the same characters multiply; keep the product of their choices at or under ${PATTERN_LIMITS.repeatChainCost.toLocaleString("en-US")}`;
          // If the piece may be skipped, what came before can still run on past it.
          const set = q.min === 0 ? meets.reduce((u, w) => union(u, w.set), atom.set) : atom.set;
          pending = dedupe([...pending.filter((w) => !meets.includes(w)), { set, cost }]);
        }
        i = q.end;
        if (p[i + 1] === "?") i++; // lazy suffix
        atom = null;
        continue;
      }
      piece = c === "." ? { source: ".", kind: "dot" } : { source: c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), kind: "char" };
    }

    // A single-character piece: required unless a quantifier makes it optional.
    const literal = piece.kind === "char" && (piece.source.length === 1 || (piece.source.length === 2 && !/[a-zA-Z0-9]/.test(piece.source[1]!)));
    if (!literal) { endRun(); closePrefixes(); }
    const set = charSet(piece.source, alphabet);
    if (set.size === 0) return "a part of the pattern matches no character";
    if (piece.kind !== "char") for (const g of groups) g.any = true;
    const before = pending;
    const ended = addChars(set);
    separate(set);
    if (literal) {
      const ch = piece.source.slice(-1).toLowerCase();
      run += ch;
      const top = groups.at(-1);
      if (top?.preOpen) top.pre += ch;
    }
    atom = { kind: piece.kind, set, first: set, complex: false, literal, before, ended };
  }
  if (groups.length) return "unbalanced parentheses";
  return null;
}

const dedupe = (ws: Wide[]) => [...new Set(ws)];

/** The smallest p with s[i] === s[i + p] for every i: how often s can line up with itself. */
export function smallestPeriod(s: string): number {
  for (let p = 1; p < s.length; p++) {
    let ok = true;
    for (let i = 0; i + p < s.length && ok; i++) ok = s[i] === s[i + p];
    if (ok) return p;
  }
  return s.length;
}

/** Whether only word boundaries and closing parentheses follow position i, to the end. */
const atTail = (p: string, i: number) => /^(?:\\b|\))*$/.test(p.slice(i));

/** A quantifier starting at i: its bounds (max -1 open-ended, -2 malformed) and last index. */
function quantifier(p: string, i: number): { min: number; max: number; end: number } | null {
  const c = p[i];
  if (c === "*") return { min: 0, max: -1, end: i };
  if (c === "+") return { min: 1, max: -1, end: i };
  if (c === "?") return { min: 0, max: 1, end: i };
  if (c !== "{") return null;
  const m = /^\{(\d+)(,(\d*))?\}/.exec(p.slice(i));
  if (!m) return null; // a literal "{"
  const min = Number(m[1]);
  const max = m[2] === undefined ? min : m[3] === "" ? -1 : Number(m[3]);
  if (max !== -1 && max < min) return { min, max: -2, end: i };
  return { min, max, end: i + m[0].length - 1 };
}
