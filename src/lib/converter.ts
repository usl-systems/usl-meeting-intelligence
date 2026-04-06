/**
 * Transcript Markdown Converter
 *
 * Converts raw transcript text into cleaned, structured markdown.
 * Handles three input formats: VTT, speaker-labeled, and raw paragraphs.
 * Pure utility — no AI model calls.
 */

type FormatType = 'vtt' | 'speaker-labeled' | 'raw';

interface SpeakerBlock {
  speaker: string;
  timestamp: string;
  lines: string[];
}

const FILLER_PATTERN = new RegExp(
  [
    '\\b(?:um|uh|uh huh)\\b[,.]?\\s*',
    '(?<=^|[.!?]\\s)(?:I mean|you know|sort of|kind of)[,.]?\\s+',
    '(?<=\\s)(?:like)(?=,\\s)',
  ].join('|'),
  'gi'
);

function detectFormat(text: string): FormatType {
  const lines = text.split('\n').slice(0, 30);

  if (lines.some((l) => l.includes('WEBVTT') || /\d{2}:\d{2}[:.]\d{2,3}\s*-->/.test(l))) {
    return 'vtt';
  }

  const speakerLineCount = lines.filter((l) =>
    /^[A-Za-z][A-Za-z\s.'-]{0,40}:\s/.test(l.trim())
  ).length;
  if (speakerLineCount >= 2) {
    return 'speaker-labeled';
  }

  return 'raw';
}

function formatTimestamp(raw: string): string {
  const match = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return '';
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = match[3] ? parseInt(match[3], 10) : 0;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function toTitleCase(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function cleanText(text: string): string {
  let cleaned = text.replace(FILLER_PATTERN, ' ');
  cleaned = cleaned.replace(/ {3,}/g, ' ');
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');
  cleaned = cleaned.trim();
  return cleaned;
}

function parseVtt(text: string): SpeakerBlock[] {
  const blocks: SpeakerBlock[] = [];
  const lines = text.split('\n');

  let currentSpeaker = '';
  let currentTimestamp = '';
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === 'WEBVTT' || line === '' || /^\d+$/.test(line) || /^NOTE\b/.test(line)) {
      continue;
    }

    const tsMatch = line.match(/(\d{2}:\d{2}[:.]\d{2,3})\s*-->\s*(\d{2}:\d{2}[:.]\d{2,3})/);
    if (tsMatch) {
      currentTimestamp = formatTimestamp(tsMatch[1]);
      continue;
    }

    // Check for speaker tag: <v Speaker Name>text</v> or Speaker Name: text
    const vTagMatch = line.match(/^<v\s+([^>]+)>(.*)$/);
    const speakerColonMatch = line.match(/^([A-Z][A-Za-z\s.'-]{0,40}):\s+(.+)$/);

    let speaker = '';
    let content = line;

    if (vTagMatch) {
      speaker = toTitleCase(vTagMatch[1]);
      content = vTagMatch[2].replace(/<\/v>/g, '').trim();
    } else if (speakerColonMatch) {
      speaker = toTitleCase(speakerColonMatch[1]);
      content = speakerColonMatch[2].trim();
    }

    // Strip any remaining HTML-like tags
    content = content.replace(/<[^>]+>/g, '').trim();
    if (!content) continue;

    if (speaker && speaker !== currentSpeaker) {
      if (currentLines.length > 0) {
        blocks.push({
          speaker: currentSpeaker,
          timestamp: currentTimestamp,
          lines: [...currentLines],
        });
      }
      currentSpeaker = speaker;
      currentLines = [content];
    } else {
      if (speaker) {
        currentLines.push(content);
      } else {
        // No speaker detected — attribute to current speaker or create generic
        if (currentSpeaker) {
          currentLines.push(content);
        } else {
          currentSpeaker = 'Speaker';
          currentLines = [content];
        }
      }
    }
  }

  if (currentLines.length > 0) {
    blocks.push({
      speaker: currentSpeaker,
      timestamp: currentTimestamp,
      lines: [...currentLines],
    });
  }

  return blocks;
}

function parseSpeakerLabeled(text: string): SpeakerBlock[] {
  const blocks: SpeakerBlock[] = [];
  const lines = text.split('\n');

  let currentSpeaker = '';
  let currentTimestamp = '';
  let currentLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Match "Speaker Name: text" or "Speaker Name [10:03]: text"
    const match = line.match(
      /^([A-Za-z][A-Za-z\s.'-]{0,40})(?:\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\])?\s*:\s+(.+)$/
    );

    if (match) {
      const speaker = toTitleCase(match[1]);
      const timestamp = match[2] ? formatTimestamp(match[2]) : '';
      const content = match[3].trim();

      if (speaker !== currentSpeaker) {
        if (currentLines.length > 0) {
          blocks.push({
            speaker: currentSpeaker,
            timestamp: currentTimestamp,
            lines: [...currentLines],
          });
        }
        currentSpeaker = speaker;
        currentTimestamp = timestamp || currentTimestamp;
        currentLines = [content];
      } else {
        if (timestamp) currentTimestamp = timestamp;
        currentLines.push(content);
      }
    } else {
      // Continuation line — append to current speaker
      if (currentSpeaker) {
        currentLines.push(line);
      }
    }
  }

  if (currentLines.length > 0) {
    blocks.push({
      speaker: currentSpeaker,
      timestamp: currentTimestamp,
      lines: [...currentLines],
    });
  }

  return blocks;
}

function blocksToMarkdown(blocks: SpeakerBlock[]): string {
  return blocks
    .map((block) => {
      const ts = block.timestamp ? ` [${block.timestamp}]` : '';
      const heading = `## ${block.speaker}${ts}`;
      const body = cleanText(block.lines.join(' '));
      return `${heading}\n\n${body}`;
    })
    .join('\n\n');
}

function convertRaw(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => cleanText(p.trim()))
    .filter(Boolean);

  return paragraphs.join('\n\n');
}

export function convertTranscript(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const format = detectFormat(trimmed);

  let markdown: string;

  switch (format) {
    case 'vtt': {
      const blocks = parseVtt(trimmed);
      markdown = blocksToMarkdown(blocks);
      break;
    }
    case 'speaker-labeled': {
      const blocks = parseSpeakerLabeled(trimmed);
      markdown = blocksToMarkdown(blocks);
      break;
    }
    case 'raw':
    default:
      markdown = convertRaw(trimmed);
      break;
  }

  // Final cleanup: collapse excessive whitespace
  markdown = markdown.replace(/ {3,}/g, ' ');
  markdown = markdown.replace(/\n{4,}/g, '\n\n\n');

  return markdown.trim();
}
