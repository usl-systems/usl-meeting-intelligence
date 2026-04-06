import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { MeetingType, ChunkSignals } from '@/types';

interface ChunkRequest {
  chunk: string;
  chunkIndex: number;
  totalChunks: number;
  meetingType: MeetingType;
}

const SYSTEM_PROMPT =
  'You are a meeting analyst. Extract structured signals from the transcript excerpt below. Output only valid JSON matching this schema exactly. Do not include any preamble, explanation, or markdown formatting. Output raw JSON only. Schema: { "decisions": [{"text": string, "rationale": string}], "pain_points": [{"speaker": string, "text": string}], "action_items": [{"description": string, "owner": string, "due_date": string}], "quote_candidates": [{"speaker": string, "timestamp": string, "text": string, "signal_type": string}], "open_questions": [string] }';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChunkRequest;
    const { chunk, chunkIndex, totalChunks, meetingType } = body;

    if (!chunk || chunkIndex === undefined || !totalChunks || !meetingType) {
      return NextResponse.json(
        { error: 'Missing required fields', detail: 'chunk, chunkIndex, totalChunks, and meetingType are required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Configuration error', detail: 'OPENROUTER_API_KEY is not set' },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
    });

    const userMessage = `Meeting type: ${meetingType}\nChunk ${chunkIndex + 1} of ${totalChunks}:\n\n${chunk}`;

    const completion = await openai.chat.completions.create(
      {
        model: model || 'qwen/qwen3-235b-a22b',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 1500,
        temperature: 0.3,
      },
      { timeout: 30000 }
    );

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: 'Empty response', detail: 'OpenRouter returned no content' },
        { status: 500 }
      );
    }

    // Strip markdown code fences if present
    const cleaned = content
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();

    const signals: ChunkSignals = JSON.parse(cleaned);

    return NextResponse.json({ signals });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Chunk processing failed', detail: message },
      { status: 500 }
    );
  }
}
