'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { runPipeline } from '@/lib/pipeline';
import { exportDocx } from '@/lib/exportDocx';
import { parseFile } from '@/lib/fileParser';
import type { MeetingType, MeetingMetadata, QualityResult } from '@/types';

const MAX_TRANSCRIPT_CHARS = 120000;

const MEETING_TYPES: { value: MeetingType; label: string; description: string }[] = [
  { value: 'sales_discovery', label: 'Sales Discovery', description: 'Needs, objections, next steps, quotes' },
  { value: 'customer_support', label: 'Customer Support', description: 'Issues, resolution, follow-up, sentiment' },
  { value: 'internal_sync', label: 'Internal Sync', description: 'Decisions, blockers, action items, owners' },
];

interface ParsedQuote {
  text: string;
  speaker: string;
  timestamp: string;
}

function parseQuotes(markdown: string): ParsedQuote[] {
  const match = markdown.match(/## Key Quotes[\s]*\n([\s\S]*?)(?=\n## |$)/);
  if (!match) return [];

  const section = match[1].trim();
  const quotes: ParsedQuote[] = [];

  // Parse quotes: lines starting with - or > or numbered, with optional speaker/timestamp
  const lines = section.split('\n').filter((l) => l.trim());

  let currentQuote = '';
  for (const line of lines) {
    const trimmed = line.trim();
    // New quote line (starts with -, >, or number)
    if (/^[-*>]|\d+\./.test(trimmed)) {
      if (currentQuote) {
        quotes.push(extractQuoteParts(currentQuote));
      }
      currentQuote = trimmed.replace(/^[-*>\d.]+\s*/, '');
    } else if (currentQuote) {
      currentQuote += ' ' + trimmed;
    }
  }
  if (currentQuote) {
    quotes.push(extractQuoteParts(currentQuote));
  }

  return quotes;
}

function extractQuoteParts(raw: string): ParsedQuote {
  // Try to extract speaker and timestamp patterns like:
  // "quote text" — Speaker Name [10:05]
  // **Speaker Name** (10:05): "quote text"
  // Speaker Name [10:05]: quote text
  let speaker = '';
  let timestamp = '';
  let text = raw;

  // Pattern: — Speaker [timestamp] or - Speaker (timestamp) at end
  const endPattern = /\s*[—–-]\s*\*{0,2}([^[(*\n]+?)\*{0,2}\s*[\[(](\d{1,2}:\d{2}(?::\d{2})?)[\])]/;
  const endMatch = text.match(endPattern);
  if (endMatch) {
    speaker = endMatch[1].trim();
    timestamp = endMatch[2];
    text = text.replace(endPattern, '').trim();
  } else {
    // Pattern: **Speaker** (timestamp): at start
    const startPattern = /^\*{0,2}([^:*\n]+?)\*{0,2}\s*[\[(](\d{1,2}:\d{2}(?::\d{2})?)[\])]\s*:\s*/;
    const startMatch = text.match(startPattern);
    if (startMatch) {
      speaker = startMatch[1].trim();
      timestamp = startMatch[2];
      text = text.replace(startPattern, '').trim();
    }
  }

  // Clean up surrounding quotes
  text = text.replace(/^[""]|[""]$/g, '').trim();

  return { text, speaker, timestamp };
}

function QualityBadge({ quality }: { quality: QualityResult }) {
  const color =
    quality.score >= 80
      ? 'bg-green-100 text-green-800'
      : quality.score >= 60
        ? 'bg-amber-100 text-amber-800'
        : 'bg-red-100 text-red-800';

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
      Quality: {quality.score} / 100
    </span>
  );
}

function QuoteCard({ quote }: { quote: ParsedQuote }) {
  return (
    <div className="border-l-4 border-blue-500 pl-4 py-3">
      <p className="text-sm text-gray-800 italic leading-relaxed">&ldquo;{quote.text}&rdquo;</p>
      {(quote.speaker || quote.timestamp) && (
        <p className="text-xs text-gray-500 mt-2">
          {quote.speaker && <span className="font-medium">{quote.speaker}</span>}
          {quote.speaker && quote.timestamp && ' · '}
          {quote.timestamp && <span>{quote.timestamp}</span>}
        </p>
      )}
    </div>
  );
}

function LoadingState({ current, total }: { current: number; total: number }) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="mt-8 p-8 bg-gray-50 border border-gray-200 rounded-lg">
      <div className="flex flex-col items-center gap-4">
        {/* Spinner */}
        <div className="w-8 h-8 border-3 border-gray-300 border-t-blue-600 rounded-full animate-spin" />

        <p className="text-sm text-gray-600 font-medium">
          {total > 0
            ? `Processing chunk ${current} of ${total}...`
            : 'Preparing transcript...'}
        </p>

        {total > 0 && (
          <div className="w-full max-w-xs">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-300"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  // Input state
  const [transcript, setTranscript] = useState('');
  const [meetingType, setMeetingType] = useState<MeetingType>('sales_discovery');
  const [fileName, setFileName] = useState<string | null>(null);

  // Metadata state
  const [showMetadata, setShowMetadata] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [attendees, setAttendees] = useState('');
  const [purpose, setPurpose] = useState('');

  // Chat log state
  const [showChatLog, setShowChatLog] = useState(false);
  const [chatLog, setChatLog] = useState('');

  // Config state
  const [configError, setConfigError] = useState<string | null>(null);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [summaryMarkdown, setSummaryMarkdown] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [transcriptWarning, setTranscriptWarning] = useState<string | null>(null);

  // Check API key on load
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (!data.config?.hasApiKey) {
          setConfigError('OpenRouter API key is not configured. Add OPENROUTER_API_KEY to your .env.local file and restart the server.');
        }
      })
      .catch(() => {
        // Health check failed — server may not be running
      });
  }, []);

  // File parsing state
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setFileError(null);
    setIsParsingFile(true);

    try {
      const text = await parseFile(file);
      setTranscript(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse file.';
      setFileError(message);
    } finally {
      setIsParsingFile(false);
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Check transcript length when it changes
  useEffect(() => {
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      setTranscriptWarning(
        `Transcript is ${transcript.length.toLocaleString()} characters (limit: ${MAX_TRANSCRIPT_CHARS.toLocaleString()}). Very long transcripts may produce lower quality output.`
      );
    } else {
      setTranscriptWarning(null);
    }
  }, [transcript]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setSummaryMarkdown(null);
    setQuality(null);
    setWarnings([]);
    setProgress({ current: 0, total: 0 });

    try {
      const metadata: MeetingMetadata = {};
      if (title) metadata.title = title;
      if (date) metadata.date = date;
      if (attendees) metadata.attendees = attendees.split(',').map((a) => a.trim()).filter(Boolean);
      if (purpose) metadata.purpose = purpose;

      const result = await runPipeline({
        transcript,
        meetingType,
        metadata,
        chatLog: chatLog || undefined,
        onProgress: (current, total) => setProgress({ current, total }),
      });

      setSummaryMarkdown(result.markdown);
      setWarnings(result.warnings);

      // Scroll to summary after a brief delay for render
      setTimeout(() => {
        summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

      // Run quality check
      try {
        const qualityRes = await fetch('/api/quality', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: result.markdown }),
        });
        if (qualityRes.ok) {
          const { result: qualityResult } = await qualityRes.json();
          setQuality(qualityResult);
        }
      } catch {
        // Quality check is non-blocking
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  // Export state
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const getExportFilename = useCallback((ext: string) => {
    const d = date || new Date().toISOString().slice(0, 10);
    if (title) {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return `${slug}-${d}.${ext}`;
    }
    const typeSlug = meetingType.replace(/_/g, '-');
    return `${typeSlug}-${d}.${ext}`;
  }, [date, title, meetingType]);

  const handleCopyMarkdown = useCallback(async () => {
    if (!summaryMarkdown) return;
    await navigator.clipboard.writeText(summaryMarkdown);
    setCopiedMarkdown(true);
    setTimeout(() => setCopiedMarkdown(false), 2000);
  }, [summaryMarkdown]);

  const handleDownloadMd = useCallback(() => {
    if (!summaryMarkdown) return;
    const blob = new Blob([summaryMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getExportFilename('md');
    a.click();
    URL.revokeObjectURL(url);
  }, [summaryMarkdown, getExportFilename]);

  const handleDownloadDocx = useCallback(async () => {
    if (!summaryMarkdown) return;
    const metadata: MeetingMetadata = {};
    if (title) metadata.title = title;
    if (date) metadata.date = date;
    if (attendees) metadata.attendees = attendees.split(',').map((a) => a.trim()).filter(Boolean);
    const blob = await exportDocx(summaryMarkdown, metadata);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getExportFilename('docx');
    a.click();
    URL.revokeObjectURL(url);
  }, [summaryMarkdown, title, date, attendees, getExportFilename]);

  const handleCopyEmail = useCallback(async () => {
    if (!summaryMarkdown) return;
    const match = summaryMarkdown.match(/## Follow-Up Email Draft[\s]*\n([\s\S]*?)(?=\n## |$)/);
    const emailText = match ? match[1].trim() : '';
    if (emailText) {
      await navigator.clipboard.writeText(emailText);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  }, [summaryMarkdown]);

  const handleNewSummary = useCallback(() => {
    setTranscript('');
    setFileName(null);
    setSummaryMarkdown(null);
    setQuality(null);
    setWarnings([]);
    setError(null);
    setProgress({ current: 0, total: 0 });
    setChatLog('');
    setTitle('');
    setDate('');
    setAttendees('');
    setPurpose('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const quotes = summaryMarkdown ? parseQuotes(summaryMarkdown) : [];
  const highSeverityIssues = quality?.issues.filter((i) => i.severity === 'high') || [];

  return (
    <main className="min-h-screen bg-white">
      <div className={`mx-auto px-6 py-12 ${summaryMarkdown ? 'max-w-6xl' : 'max-w-3xl'} transition-all`}>
        {/* Config Error Banner */}
        {configError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {configError}
          </div>
        )}

        {/* Header */}
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Meeting Intelligence</h1>
        <p className="text-gray-500 mb-10">
          Paste a transcript, choose a meeting type, get a structured summary.
        </p>

        {/* Transcript Input */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="transcript" className="text-sm font-medium text-gray-700">
              Paste your transcript or upload a file
            </label>
            <div className="flex items-center gap-2">
              {fileName && (
                <span className="text-sm text-gray-500 truncate max-w-[200px]">{fileName}</span>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isParsingFile}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-400"
              >
                {isParsingFile ? 'Reading file...' : 'Upload file'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.vtt,.docx"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>
          <textarea
            id="transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste your Teams meeting transcript here..."
            className="w-full min-h-[300px] p-4 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
          />
          {fileError && (
            <p className="mt-2 text-sm text-red-600">{fileError}</p>
          )}
          {transcriptWarning && (
            <p className="mt-2 text-sm text-amber-600">{transcriptWarning}</p>
          )}
        </div>

        {/* Meeting Type Selector */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-3">Meeting type</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {MEETING_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => setMeetingType(type.value)}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${
                  meetingType === type.value
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className={`text-sm font-semibold ${meetingType === type.value ? 'text-blue-700' : 'text-gray-900'}`}>
                  {type.label}
                </div>
                <div className="text-xs text-gray-500 mt-1">{type.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Optional Metadata */}
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setShowMetadata(!showMetadata)}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-medium"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showMetadata ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Meeting details (optional)
          </button>
          {showMetadata && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
              <div>
                <label htmlFor="title" className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                <input
                  id="title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Q3 Pipeline Review"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="date" className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="attendees" className="block text-xs font-medium text-gray-600 mb-1">Attendees</label>
                <input
                  id="attendees"
                  type="text"
                  value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                  placeholder="Sarah Jones, Mark Chen, Lisa Park"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="purpose" className="block text-xs font-medium text-gray-600 mb-1">Purpose</label>
                <input
                  id="purpose"
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g. Discuss Q3 targets"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Optional Chat Log */}
        <div className="mb-8">
          <button
            type="button"
            onClick={() => setShowChatLog(!showChatLog)}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-medium"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showChatLog ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Teams chat log (optional)
          </button>
          {showChatLog && (
            <textarea
              value={chatLog}
              onChange={(e) => setChatLog(e.target.value)}
              placeholder="Paste the Teams meeting chat here..."
              className="mt-3 w-full min-h-[150px] p-4 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
            />
          )}
        </div>

        {/* Generate Button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!transcript.trim() || isGenerating || !!configError}
          className="w-full py-3.5 bg-blue-600 text-white font-semibold rounded-lg text-base hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {isGenerating ? 'Generating...' : 'Generate Summary'}
        </button>

        {/* Error Display */}
        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Loading State */}
        {isGenerating && (
          <LoadingState current={progress.current} total={progress.total} />
        )}

        {/* Pipeline Warnings */}
        {warnings.length > 0 && !isGenerating && (
          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            {warnings.map((w, i) => (
              <p key={i} className="text-sm text-amber-700">{w}</p>
            ))}
          </div>
        )}

        {/* Summary Display */}
        {summaryMarkdown && !isGenerating && (
          <div className="mt-8" ref={summaryRef}>
            {/* Export Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-gray-200">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  className="px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {copiedMarkdown ? 'Copied!' : 'Copy Markdown'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadMd}
                  className="px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Download .md
                </button>
                <button
                  type="button"
                  onClick={handleDownloadDocx}
                  className="px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Download .docx
                </button>
                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {copiedEmail ? 'Copied!' : 'Copy Email'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {quality && <QualityBadge quality={quality} />}
                <button
                  type="button"
                  onClick={handleNewSummary}
                  className="px-3.5 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                >
                  New Summary
                </button>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
              {/* Left Column: Rendered Markdown */}
              <div className="lg:w-[60%] min-w-0">
                <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-headings:font-semibold prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-h2:pb-2 prose-h2:border-b prose-h2:border-gray-200 prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900 prose-table:text-sm prose-th:bg-gray-50 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-medium prose-th:text-gray-700 prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-gray-200 prose-blockquote:border-l-blue-500 prose-blockquote:bg-blue-50 prose-blockquote:py-1 prose-blockquote:text-gray-700">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {summaryMarkdown}
                  </ReactMarkdown>
                </div>
              </div>

              {/* Right Column: Key Quotes Panel */}
              <div className="lg:w-[40%]">
                <div className="sticky top-8">
                  {/* Quality Warnings */}
                  {highSeverityIssues.length > 0 && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs font-semibold text-amber-800 mb-1">Quality warnings</p>
                      <ul className="space-y-1">
                        {highSeverityIssues.map((issue, i) => (
                          <li key={i} className="text-xs text-amber-700">{issue.description}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <h3 className="text-sm font-semibold text-gray-900 mb-4">Key Quotes</h3>

                  {quotes.length > 0 ? (
                    <div className="space-y-4">
                      {quotes.map((quote, i) => (
                        <QuoteCard key={i} quote={quote} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No quotes extracted.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
