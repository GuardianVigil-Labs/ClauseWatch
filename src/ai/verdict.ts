// Words that judge a service, refused in anything AI writes:
// a summary sentence or a finding's explanation. A quote is the document's
// own words; what AI adds may never be a verdict.

/** Words that judge a service rather than say what a clause allows. */
export const VERDICT =
  /\b(safe|safer|safely|safety|harmless|compliant|compliance|standard|normal|typical|reasonable|acceptable|benign|trust(worthy|ed)?|legit(imate)?|risk[- ]free|(low|no|not|little|minimal) risk(s|y)?|not risky|nothing (to worry|unusual|concerning)|no need to worry|no (concerns?|red flags?|issues?)|fine|okay|ok|secure|fair|good|score[sd]?|grade[sd]?|rat(ed|ing))\b/i;

/** Text as checked: look-alike letters folded, invisible characters removed. */
export const foldForCheck = (t: string) => t.normalize("NFKC").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
