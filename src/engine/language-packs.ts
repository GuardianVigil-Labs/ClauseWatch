import es from "../../rules/es/rules.json";
import fr from "../../rules/fr/rules.json";
import type { Coverage } from "./language";
import { compileRules, type CompiledRules, type RulesFile } from "./rules";
const packs: Record<string, CompiledRules> = { es: compileRules(es as RulesFile), fr: compileRules(fr as RulesFile) };
/**
 * The rules for a document: a language pack alone only when the text itself
 * was confidently identified as that language. A guess (the page's lang
 * attribute, a short or mixed text) runs the English rules too, so a mislabelled
 * English policy is still checked; any other language gets the English rules.
 */
export function languageRules(coverage: Pick<Coverage, "language" | "confident">, fallback: CompiledRules): CompiledRules {
  const pack = packs[coverage.language];
  if (!pack) return fallback;
  if (coverage.confident) return { ...pack, minQuoteWords: fallback.minQuoteWords };
  return { ...fallback, categories: [...new Set([...fallback.categories, ...pack.categories])], rules: [...fallback.rules, ...pack.rules] };
}
