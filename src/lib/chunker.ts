/**
 * Transcript Chunker
 *
 * Splits cleaned markdown into chunks of approximately `targetTokens` tokens.
 * Splits at speaker boundaries (## headings) when possible, never mid-sentence.
 * Adds 100-token overlap at each boundary.
 */

import { encoding_for_model } from 'tiktoken';

const OVERLAP_TOKENS = 100;

let enc: ReturnType<typeof encoding_for_model> | null = null;

function getEncoder() {
  if (!enc) {
    enc = encoding_for_model('gpt-4');
  }
  return enc;
}

function countTokens(text: string): number {
  return getEncoder().encode(text).length;
}

function decodeTokens(tokens: number[]): string {
  return new TextDecoder().decode(getEncoder().decode(new Uint32Array(tokens)));
}

function getLastNTokens(text: string, n: number): string {
  const tokens = Array.from(getEncoder().encode(text));
  if (tokens.length <= n) return text;
  return decodeTokens(tokens.slice(-n));
}

/**
 * Split markdown into sections at ## headings.
 * Each section includes its heading.
 */
function splitIntoSections(markdown: string): string[] {
  const parts = markdown.split(/(?=^## )/m);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Split a section into sentences, keeping sentence-ending punctuation attached.
 */
function splitIntoSentences(text: string): string[] {
  const result: string[] = [];
  // Split on sentence-ending punctuation followed by a space or newline
  const parts = text.split(/(?<=[.!?])\s+/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) result.push(trimmed);
  }
  return result;
}

/**
 * Build chunks from sentences, respecting the token target.
 * Never splits mid-sentence.
 */
function buildChunksFromSentences(
  sentences: string[],
  targetTokens: number
): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (countTokens(candidate) > targetTokens && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function chunkTranscript(
  markdown: string,
  targetTokens: number = 2000
): string[] {
  if (!markdown.trim()) return [];

  const sections = splitIntoSections(markdown);
  const rawChunks: string[] = [];

  let accumulator = '';

  for (const section of sections) {
    const candidate = accumulator
      ? `${accumulator}\n\n${section}`
      : section;

    if (countTokens(candidate) <= targetTokens) {
      accumulator = candidate;
    } else {
      // Current accumulator is a complete chunk
      if (accumulator) {
        rawChunks.push(accumulator.trim());
      }

      // Check if this single section exceeds the target
      if (countTokens(section) > targetTokens) {
        // Break the section into sentences and chunk them
        const sentences = splitIntoSentences(section);
        const subChunks = buildChunksFromSentences(sentences, targetTokens);
        rawChunks.push(...subChunks);
        accumulator = '';
      } else {
        accumulator = section;
      }
    }
  }

  if (accumulator.trim()) {
    rawChunks.push(accumulator.trim());
  }

  // If we ended up with nothing, return the whole thing as one chunk
  if (rawChunks.length === 0) {
    return [markdown.trim()];
  }

  // Add overlap: prepend last 100 tokens of previous chunk to each subsequent chunk
  const chunks: string[] = [rawChunks[0]];

  for (let i = 1; i < rawChunks.length; i++) {
    const overlap = getLastNTokens(rawChunks[i - 1], OVERLAP_TOKENS);
    chunks.push(`${overlap}\n\n${rawChunks[i]}`);
  }

  return chunks;
}
