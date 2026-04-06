import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { runPreCheck } from '@/lib/qualityCheck';
import type { QualityResult } from '@/types';

const SYSTEM_PROMPT = `You are a quality reviewer for meeting summaries. Check the summary below and return a JSON object with this schema:

{ "issues": [{"type": "missing_owner|missing_decision|weak_quote|missing_next_steps|missing_outcome", "description": string, "severity": "high|medium|low"}], "score": number (0-100), "passed": boolean }

Flag as high severity: action items with no owner, zero key quotes, no decisions section. Flag as medium: TBD due dates on more than 3 items, fewer than 4 quotes. Score of 80 or above passes.

Output only valid JSON. No preamble, no markdown formatting.`;

const DEFAULT_FAIL_RESULT: QualityResult = {
  issues: [
    {
      type: 'parse_error',
      description: 'Quality check response could not be parsed.',
      severity: 'high',
    },
  ],
  score: 0,
  passed: false,
};

function deduplicateIssues(
  issues: QualityResult['issues']
): QualityResult['issues'] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.type}:${issue.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { markdown } = body;

    if (!markdown) {
      return NextResponse.json(
        { error: 'markdown is required' },
        { status: 400 }
      );
    }

    // Run rule-based pre-check first
    const preCheckResult = runPreCheck(markdown);
    const hasHighSeverity = preCheckResult.issues.some(
      (i) => i.severity === 'high'
    );

    // If pre-check finds high severity issues, return immediately
    if (hasHighSeverity) {
      return NextResponse.json({ result: preCheckResult });
    }

    // Otherwise, call the model for deeper review
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL;

    if (!apiKey) {
      // Return pre-check result if we can't call the model
      return NextResponse.json({ result: preCheckResult });
    }

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
    });

    const completion = await openai.chat.completions.create(
      {
        model: model || 'qwen/qwen3-235b-a22b',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: markdown },
        ],
        max_tokens: 1000,
        temperature: 0.2,
      },
      { timeout: 30000 }
    );

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ result: preCheckResult });
    }

    // Parse model response
    let modelResult: QualityResult;
    try {
      const cleaned = content
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
      modelResult = JSON.parse(cleaned);
    } catch {
      // Parse failed — return default fail merged with pre-check
      const merged: QualityResult = {
        ...DEFAULT_FAIL_RESULT,
        issues: deduplicateIssues([
          ...preCheckResult.issues,
          ...DEFAULT_FAIL_RESULT.issues,
        ]),
      };
      return NextResponse.json({ result: merged });
    }

    // Merge and deduplicate issues from both sources
    const mergedIssues = deduplicateIssues([
      ...preCheckResult.issues,
      ...modelResult.issues,
    ]);

    const mergedResult: QualityResult = {
      issues: mergedIssues,
      score: Math.min(preCheckResult.score, modelResult.score),
      passed: preCheckResult.passed && modelResult.passed,
    };

    return NextResponse.json({ result: mergedResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Quality check failed: ${message}` },
      { status: 500 }
    );
  }
}
