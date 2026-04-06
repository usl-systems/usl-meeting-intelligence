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

export async function runPipeline({
  transcript,
  meetingType,
  metadata = {},
  chatLog,
  onProgress,
}: PipelineArgs): Promise<string> {
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

  // Stage 3: Call /api/chunk for each chunk with 500ms delay between calls
  const allSignals: ChunkSignals[] = [];

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i + 1, chunks.length);

    const response = await fetch('/api/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chunk: chunks[i],
        chunkIndex: i,
        totalChunks: chunks.length,
        meetingType,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Chunk ${i + 1} failed: ${err.error || err.detail || response.statusText}`);
    }

    const data = await response.json();
    allSignals.push(data.signals);

    // Rate limit delay between calls (skip after last chunk)
    if (i < chunks.length - 1) {
      await delay(500);
    }
  }

  // Stage 4: Call /api/summarize with all chunk signals
  const summarizeResponse = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chunkSignals: allSignals,
      metadata,
      meetingType,
      chatLog: chatLog || undefined,
    }),
  });

  if (!summarizeResponse.ok) {
    const err = await summarizeResponse.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Summarization failed: ${err.error || summarizeResponse.statusText}`);
  }

  const result = await summarizeResponse.json();
  return result.markdown;
}
