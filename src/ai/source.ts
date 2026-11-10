// Conservative source boundaries for AI. Semicolons and wrapped lines stay
// with their qualifications; uncertain or unterminated fragments are omitted.
export const AI_CHUNK_CHARS = 24_000;
export const squash = (text: string) => text.replace(/\s+/g, " ").trim();
export interface SourceSentence { text: string; start: number; end: number }

export function sourceSentences(body: string): SourceSentence[] {
  const out: SourceSentence[] = [];
  const paragraphs = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  for (const paragraph of body.matchAll(paragraphs)) {
    const text = paragraph[0];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (!/[.!?]/.test(text[i]!)) continue;
      let end = i + 1;
      while (end < text.length && /[.!?"'”’\])}]/.test(text[end]!)) end++;
      if (end < text.length && !/\s/.test(text[end]!)) continue;
      const prefix = text.slice(Math.max(start, i - 80), i + 1);
      // Joining uncertain boundaries is preferable to displaying a fragment.
      if (text[i] === "." && /\b(?:e\.g|i\.e|etc|inc|ltd|co|dr|mr|mrs|ms|vs|no|sec|art|u\.s|[A-Z])\.$/i.test(prefix)) continue;
      const next = text.slice(end).trimStart();
      if (next && (/^[\p{Ll}]/u.test(next) || /^(?:Except|Unless|Provided|Subject to|Only if|Only when|But|However)\b/.test(next))) continue;
      const raw = text.slice(start, end);
      const left = raw.length - raw.trimStart().length;
      const quote = raw.trim();
      if (quote && !/\.{2,}["'”’\])}]*$/.test(quote)) out.push({ text: quote, start: paragraph.index + start + left, end: paragraph.index + end });
      start = end;
      i = end - 1;
    }
  }
  return out;
}

export interface AiChunk { text: string; start: number; end: number }
export interface AiCoverage {
  totalChars: number;
  coveredChars: number;
  skippedSentences: number;
  chunks: AiChunk[];
}

/** Partition without cutting a sentence, including one neighboring sentence
 * of overlap when it fits. Every accepted quote is validated in its own chunk. */
export function planAiCoverage(body: string): AiCoverage {
  const sentences = sourceSentences(body);
  const chunks: AiChunk[] = [];
  let skippedSentences = 0;
  let group: SourceSentence[] = [];
  const flush = () => {
    if (!group.length) return;
    const start = group[0]!.start;
    const end = group.at(-1)!.end;
    chunks.push({ text: body.slice(start, end), start, end });
  };
  for (const sentence of sentences) {
    if (sentence.text.length > AI_CHUNK_CHARS) { flush(); group = []; skippedSentences++; continue; }
    if (group.length && /\S/.test(body.slice(group.at(-1)!.end, sentence.start))) { flush(); group = []; }
    if (group.length && sentence.end - group[0]!.start > AI_CHUNK_CHARS) {
      flush();
      const last = group.at(-1)!;
      group = sentence.end - last.start <= AI_CHUNK_CHARS ? [last] : [];
    }
    group.push(sentence);
  }
  flush();
  let coveredChars = 0;
  let previousEnd = 0;
  for (const chunk of chunks) { coveredChars += chunk.end - Math.max(previousEnd, chunk.start); previousEnd = chunk.end; }
  return { totalChars: body.length, coveredChars, skippedSentences, chunks };
}
