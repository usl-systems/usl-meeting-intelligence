/**
 * Rule-based quality pre-check
 *
 * Catches obvious issues without spending tokens.
 * Runs BEFORE the model-based quality check.
 */

import type { QualityResult } from '@/types';

interface QualityIssue {
  type: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

function extractSection(markdown: string, heading: string): string | null {
  const pattern = new RegExp(
    `^## ${heading}[\\s]*\\n([\\s\\S]*?)(?=^## |\\z)`,
    'm'
  );
  const match = markdown.match(pattern);
  return match ? match[1].trim() : null;
}

export function runPreCheck(markdown: string): QualityResult {
  const issues: QualityIssue[] = [];

  // Check total word count
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  if (wordCount < 300) {
    issues.push({
      type: 'short_output',
      description: `Summary is only ${wordCount} words (minimum expected: 300). Likely a failed generation.`,
      severity: 'high',
    });
  }

  // Check ## Next Steps section
  const nextSteps = extractSection(markdown, 'Next Steps');
  if (nextSteps === null) {
    issues.push({
      type: 'missing_next_steps',
      description: 'Missing ## Next Steps section.',
      severity: 'high',
    });
  } else {
    const tbdCount = (nextSteps.match(/\bTBD\b/g) || []).length;
    if (tbdCount > 4) {
      issues.push({
        type: 'excessive_tbd',
        description: `Next Steps section contains ${tbdCount} TBD entries (maximum recommended: 4).`,
        severity: 'medium',
      });
    }
  }

  // Check ## Key Quotes section
  const keyQuotes = extractSection(markdown, 'Key Quotes');
  if (keyQuotes === null) {
    issues.push({
      type: 'missing_quotes',
      description: 'Missing ## Key Quotes section.',
      severity: 'high',
    });
  } else {
    const quoteLines = keyQuotes
      .split('\n')
      .filter((l) => l.trim().length > 0);
    if (quoteLines.length < 2) {
      issues.push({
        type: 'weak_quote',
        description: `Key Quotes section has only ${quoteLines.length} line(s) (minimum expected: 2).`,
        severity: 'high',
      });
    }
  }

  // Check ## Key Decisions section
  const keyDecisions = extractSection(markdown, 'Key Decisions');
  if (keyDecisions === null || keyDecisions.length === 0) {
    issues.push({
      type: 'missing_decision',
      description: 'Missing or empty ## Key Decisions section.',
      severity: 'medium',
    });
  }

  const hasHighSeverity = issues.some((i) => i.severity === 'high');
  const score = hasHighSeverity ? Math.max(0, 40 - issues.length * 10) : Math.max(50, 80 - issues.length * 10);

  return {
    issues,
    score,
    passed: !hasHighSeverity && score >= 80,
  };
}
