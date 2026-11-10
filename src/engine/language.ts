import { detectAll } from "tinyld/light";

/** `confident`: the text itself was identified; otherwise the language is a guess (page metadata or wording). */
export interface Coverage { language: string; status: "english" | "supported" | "unsupported" | "unknown"; confident?: boolean }
const status = (language: string): Coverage["status"] => language === "en" ? "english" : ["es", "fr"].includes(language) ? "supported" : "unsupported";
/** A local estimate, not a translation. Uncertain text never implies language support. */
export function languageCoverage(body: string, declared = ""): Coverage {
  const tag = declared.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  const sample = body.slice(0, 6000);
  const ranked = sample.length >= 120 ? detectAll(sample) : [];
  const best = ranked[0];
  // A useful margin avoids declaring a language from a near tie or a short heading.
  if (best && best.lang && best.accuracy >= 0.6 && (!ranked[1] || best.accuracy - ranked[1].accuracy >= 0.15)) {
    return { language: best.lang, status: status(best.lang), confident: true };
  }
  if (tag && tag !== "und") return { language: tag, status: status(tag), confident: false };
  if (!/\b(we|you|our|your)\b/i.test(sample)) {
    if (/pol[ií]tica de privacidad|t[eé]rminos de (uso|servicio)|datos personales|suscripci[oó]n/i.test(sample)) return { language: "es", status: "supported", confident: false };
    if (/politique de confidentialit[eé]|conditions g[eé]n[eé]rales|vos donn[eé]es|votre abonnement/i.test(sample)) return { language: "fr", status: "supported", confident: false };
  }
  if (/\b(we|your|you|our|the|this|these)\b/i.test(sample) && /\b(data|information|service|account|collect|terms|privacy|agreement|licen[cs]e)\b/i.test(sample)) return { language: "en", status: "english", confident: false };
  return { language: "und", status: "unknown", confident: false };
}
