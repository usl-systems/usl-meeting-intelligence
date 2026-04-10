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

const REQUIRED_SECTIONS = [
  'Executive Summary',
  'Key Decisions',
  'Customer Needs and Pain Points',
  'Objections, Risks, and Open Questions',
  'Next Steps',
  'Key Quotes',
  'Meeting Outcomes',
  'Follow-Up Email Draft',
];

function extractSection(markdown: string, heading: string): string | null {
  // Split markdown into sections by ## headings
  const sections = markdown.split(/^## /m);

  for (const section of sections) {
    // Check if this section starts with the heading we want
    const firstLine = section.split('\n')[0]?.trim();
    if (firstLine === heading) {
      const body = section.slice(firstLine.length).trim();
      return body;
    }
  }

  return null;
}

function countQuotes(section: string): number {
  const lines = section.split('\n').filter((l) => l.trim().length > 0);
  // Count lines starting with > or - or * or numbered list items (quote formats vary)
  return lines.filter((l) => {
    const t = l.trim();
    return t.startsWith('>') || t.startsWith('-') || t.startsWith('*') || /^\d+\./.test(t);
  }).length;
}

export function runPreCheck(markdown: string): QualityResult {
  const issues: QualityIssue[] = [];

  // Check total word count
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  if (wordCount < 200) {
    issues.push({
      type: 'short_output',
      description: `Summary is only ${wordCount} words (minimum expected: 200). Likely a failed generation.`,
      severity: 'high',
    });
  }

  // Check all 8 required sections exist
  for (const section of REQUIRED_SECTIONS) {
    const content = extractSection(markdown, section);
    if (content === null) {
      const isHighSeverity = ['Executive Summary', 'Next Steps', 'Key Quotes', 'Follow-Up Email Draft'].includes(section);
      issues.push({
        type: 'missing_section',
        description: `Missing ## ${section} section.`,
        severity: isHighSeverity ? 'high' : 'medium',
      });
    }
  }

  // Check Next Steps for excessive TBDs
  const nextSteps = extractSection(markdown, 'Next Steps');
  if (nextSteps) {
    const tbdCount = (nextSteps.match(/\bTBD\b/g) || []).length;
    const rowCount = (nextSteps.match(/^\|(?!\s*-)/gm) || []).length - 1;
    if (rowCount > 0 && tbdCount > Math.ceil(rowCount * 0.6)) {
      issues.push({
        type: 'excessive_tbd',
        description: `${tbdCount} of ${rowCount} action items have TBD dates.`,
        severity: 'medium',
      });
    }
  }

  // Check Key Quotes has enough content
  const keyQuotes = extractSection(markdown, 'Key Quotes');
  if (keyQuotes !== null) {
    const quoteCount = countQuotes(keyQuotes);
    if (quoteCount < 2) {
      issues.push({
        type: 'weak_quote',
        description: `Key Quotes has only ${quoteCount} quote(s) (expected at least 3).`,
        severity: 'medium',
      });
    }
  }

  // Check Key Decisions has content
  const keyDecisions = extractSection(markdown, 'Key Decisions');
  if (keyDecisions !== null && keyDecisions.length === 0) {
    issues.push({
      type: 'empty_decisions',
      description: 'Key Decisions section is empty.',
      severity: 'medium',
    });
  }

  // Score: start at 95, deduct per issue
  const highCount = issues.filter((i) => i.severity === 'high').length;
  const mediumCount = issues.filter((i) => i.severity === 'medium').length;
  const score = Math.max(0, 95 - highCount * 20 - mediumCount * 5);

  return {
    issues,
    score,
    passed: highCount === 0 && score >= 75,
  };
}
