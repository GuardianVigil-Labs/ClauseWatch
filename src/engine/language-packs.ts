import es from "../../rules/es/rules.json";
import fr from "../../rules/fr/rules.json";
import { compileRules, type CompiledRules, type RulesFile } from "./rules";
const packs: Record<string, CompiledRules> = { es: compileRules(es as RulesFile), fr: compileRules(fr as RulesFile) };
export function languageRules(language: string, fallback: CompiledRules): CompiledRules {
  return packs[language] ? { ...packs[language]!, minQuoteWords: fallback.minQuoteWords } : fallback;
}
