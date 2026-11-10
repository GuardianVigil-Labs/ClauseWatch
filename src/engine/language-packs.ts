import es from "../../rules/es/rules.json";
import fr from "../../rules/fr/rules.json";
import type { Coverage } from "./language";
import { compileRules, type CompiledRules, type RulesFile } from "./rules";
const packs: Record<string, CompiledRules> = { es: compileRules(es as RulesFile), fr: compileRules(fr as RulesFile) };
/** The English rule each pack rule translates: switching that rule off in Settings switches its translations off too. */
export const TRANSLATES: Record<string, string> = {
  "es-data-sale": "sells-personal-data", "fr-data-sale": "sells-personal-data",
  "es-renewal": "automatic-renewal", "fr-renewal": "automatic-renewal",
  "es-arbitration": "binding-arbitration", "fr-arbitration": "binding-arbitration",
};
/**
 * The rules for a document: a language pack alone only when the text itself
 * was confidently identified as that language. A guess (the page's lang
 * attribute, a short or mixed text) runs the English rules too, so a mislabelled
 * English policy is still checked; any other language gets the English rules.
 * The person's switched-off rules stay off and their own rules run in every case.
 */
export function languageRules(coverage: Pick<Coverage, "language" | "confident">, fallback: CompiledRules): CompiledRules {
  const pack = packs[coverage.language];
  if (!pack) return fallback;
  const off = new Set(fallback.disabled ?? []);
  const packRules = pack.rules.filter((r) => !off.has(r.id) && !off.has(TRANSLATES[r.id] ?? ""));
  const rules = coverage.confident ? [...packRules, ...(fallback.own ?? [])] : [...fallback.rules, ...packRules];
  const order = coverage.confident ? [...pack.categories, ...fallback.categories] : [...fallback.categories, ...pack.categories];
  const categories = [...new Set(order)].filter((c) => rules.some((r) => r.category === c));
  return { ...fallback, categories, rules };
}
