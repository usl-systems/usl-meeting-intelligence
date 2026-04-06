import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { ChunkSignals, MeetingMetadata, MeetingType } from '@/types';

interface SummarizeRequest {
  chunkSignals: ChunkSignals[];
  metadata: MeetingMetadata;
  meetingType: MeetingType;
  chatLog?: string;
}

const SYSTEM_PROMPT = `You are a senior meeting summarizer. You will receive structured signals extracted from chunks of a meeting transcript. Consolidate them into a final summary with these eight sections, in this exact order:

## Executive Summary
5-8 bullets covering the most important outcomes of the meeting.

## Key Decisions
Explicit decisions made during the meeting, each with a brief note on why that decision was reached.

## Customer Needs and Pain Points
Verbatim or near-verbatim statements from the customer describing their challenges, goals, or requirements.

## Objections, Risks, and Open Questions
Concerns raised, unresolved questions, and risks flagged. Tag each item as [Objection], [Risk], or [Open Question].

## Next Steps
Action items as a markdown table with columns: Owner | Action | Due Date. Use TBD if unknown.

## Key Quotes
4-8 verbatim quotes with the strongest signal. Include speaker and timestamp if available.

## Meeting Outcomes
What materially changed as a result of this meeting — shifts in understanding, relationship, or agreed direction.

## Follow-Up Email Draft
A short, professional email (under 200 words) suitable for sending to attendees immediately after the meeting.

Rules: Remove duplicates. Prefer specificity over generality. Quotes must be verbatim from the input, not paraphrased. Output clean markdown only. No JSON. No preamble.`;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SummarizeRequest;
    const { chunkSignals, metadata, meetingType, chatLog } = body;

    if (!chunkSignals?.length || !meetingType) {
      return NextResponse.json(
        { error: 'chunkSignals and meetingType are required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY is not set' },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
    });

    const title = metadata?.title || 'Untitled Meeting';
    const date = metadata?.date || 'Not specified';
    const attendees = metadata?.attendees?.join(', ') || 'Not specified';

    let userMessage = `Meeting: ${title} | Date: ${date} | Type: ${meetingType} | Attendees: ${attendees}`;

    if (metadata?.purpose) {
      userMessage += `\nPurpose: ${metadata.purpose}`;
    }

    if (chatLog) {
      userMessage += `\n\nTeams Chat Context:\n${chatLog}`;
    }

    userMessage += `\n\nChunk signals:\n${JSON.stringify(chunkSignals, null, 2)}`;

    const completion = await openai.chat.completions.create(
      {
        model: model || 'qwen/qwen3-235b-a22b',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 3000,
        temperature: 0.3,
      },
      { timeout: 60000 }
    );

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: 'OpenRouter returned no content' },
        { status: 500 }
      );
    }

    return NextResponse.json({ markdown: content.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Summarization failed: ${message}` },
      { status: 500 }
    );
  }
}
