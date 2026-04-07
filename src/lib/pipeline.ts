/**
 * Pipeline Orchestrator
 *
 * Runs the full summarization pipeline:
 * convert -> chunk -> call /api/chunk for each chunk -> call /api/summarize
 *
 * This is the only function the frontend calls.
 */

import { convertTranscript } from './converter';
import { chunkTranscript } from './chunker';
import type { MeetingType, MeetingMetadata, ChunkSignals } from '@/types';

export interface PipelineResult {
  markdown: string;
  warnings: string[];
}

interface PipelineArgs {
  transcript: string;
  meetingType: MeetingType;
  metadata?: MeetingMetadata;
  chatLog?: string;
  onProgress?: (current: number, total: number) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message.includes('fetch')) return true;
  if (err instanceof Error && (err.message.includes('NetworkError') || err.message.includes('Failed to fetch'))) return true;
  return false;
}

async function fetchChunkWithRetry(
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  meetingType: MeetingType
): Promise<{ signals: ChunkSignals | null; warning: string | null }> {
  const body = JSON.stringify({ chunk, chunkIndex, totalChunks, meetingType });
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };

  // First attempt
  try {
    const response = await fetch('/api/chunk', opts);
    if (response.ok) {
      const data = await response.json();
      return { signals: data.signals, warning: null };
    }
    // 5xx or timeout — fall through to retry
    if (response.status < 500) {
      // 4xx errors are not retryable
      return { signals: null, warning: `Chunk ${chunkIndex + 1} returned error ${response.status} and was skipped.` };
    }
  } catch (err) {
    if (isNetworkError(err)) throw err; // Don't retry network errors — bubble up
  }

  // Retry after 2 second delay
  await delay(2000);

  try {
    const response = await fetch('/api/chunk', opts);
    if (response.ok) {
      const data = await response.json();
      return { signals: data.signals, warning: null };
    }
  } catch (err) {
    if (isNetworkError(err)) throw err;
  }

  // Both attempts failed — skip this chunk
  return { signals: null, warning: `Chunk ${chunkIndex + 1} could not be processed and was skipped.` };
}

export async function runPipeline({
  transcript,
  meetingType,
  metadata = {},
  chatLog,
  onProgress,
}: PipelineArgs): Promise<PipelineResult> {
  const warnings: string[] = [];

  // Stage 1: Convert raw transcript to cleaned markdown
  const markdown = convertTranscript(transcript);

  if (!markdown) {
    throw new Error('Transcript conversion produced no output');
  }

  // Stage 2: Chunk the cleaned markdown
  const targetTokens = parseInt(process.env.NEXT_PUBLIC_CHUNK_TOKEN_TARGET || '2000', 10);
  const chunks = chunkTranscript(markdown, targetTokens);

  if (chunks.length === 0) {
    throw new Error('Chunking produced no output');
  }

  // Stage 3: Call /api/chunk for each chunk with retry logic
  const allSignals: ChunkSignals[] = [];

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i + 1, chunks.length);

    const { signals, warning } = await fetchChunkWithRetry(
      chunks[i], i, chunks.length, meetingType
    );

    if (signals) {
      allSignals.push(signals);
    }
    if (warning) {
      warnings.push(warning);
    }

    // Rate limit delay between calls (skip after last chunk)
    if (i < chunks.length - 1) {
      await delay(500);
    }
  }

  if (allSignals.length === 0) {
    throw new Error('All chunks failed to process. Cannot generate summary.');
  }

  // Stage 4: Call /api/summarize with all chunk signals
  let summarizeResponse: Response;
  try {
    summarizeResponse = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chunkSignals: allSignals,
        metadata,
        meetingType,
        chatLog: chatLog || undefined,
      }),
    });
  } catch (err) {
    if (isNetworkError(err)) {
      throw new Error('Generation failed. Check your connection and try again.');
    }
    throw err;
  }

  if (!summarizeResponse.ok) {
    const err = await summarizeResponse.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Summarization failed: ${err.error || summarizeResponse.statusText}`);
  }

  const result = await summarizeResponse.json();
  const summaryMarkdown = result.markdown;

  // Check if output has all 8 sections
  const requiredSections = [
    'Executive Summary', 'Key Decisions', 'Customer Needs and Pain Points',
    'Objections, Risks, and Open Questions', 'Next Steps', 'Key Quotes',
    'Meeting Outcomes', 'Follow-Up Email Draft',
  ];
  const missingSections = requiredSections.filter(
    (s) => !summaryMarkdown.includes(`## ${s}`)
  );
  if (missingSections.length > 0) {
    warnings.push('The summary could not be fully structured. Raw output is shown below.');
  }

  return { markdown: summaryMarkdown, warnings };
}
