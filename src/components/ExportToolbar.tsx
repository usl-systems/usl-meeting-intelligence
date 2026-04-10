'use client';

import { useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { exportDocx } from '@/lib/exportDocx';
import type { MeetingMetadata, MeetingType, QualityResult } from '@/types';

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

interface ExportToolbarProps {
  markdown: string;
  quality: QualityResult | null;
  title: string;
  date: string;
  attendees: string;
  meetingType: MeetingType;
  onNewSummary: () => void;
}

export default function ExportToolbar({
  markdown,
  quality,
  title,
  date,
  attendees,
  meetingType,
  onNewSummary,
}: ExportToolbarProps) {
  const { toast } = useToast();

  const getExportFilename = useCallback(
    (ext: string) => {
      const d = date || new Date().toISOString().slice(0, 10);
      if (title) {
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `${slug}-${d}.${ext}`;
      }
      const typeSlug = meetingType.replace(/_/g, '-');
      return `${typeSlug}-${d}.${ext}`;
    },
    [date, title, meetingType]
  );

  const handleCopyMarkdown = useCallback(async () => {
    await navigator.clipboard.writeText(markdown);
    toast('Markdown copied to clipboard');
  }, [markdown, toast]);

  const handleDownloadMd = useCallback(() => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getExportFilename('md');
    a.click();
    URL.revokeObjectURL(url);
    toast('Downloaded ' + getExportFilename('md'));
  }, [markdown, getExportFilename, toast]);

  const handleDownloadDocx = useCallback(async () => {
    const metadata: MeetingMetadata = {};
    if (title) metadata.title = title;
    if (date) metadata.date = date;
    if (attendees) metadata.attendees = attendees.split(',').map((a) => a.trim()).filter(Boolean);
    const blob = await exportDocx(markdown, metadata);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getExportFilename('docx');
    a.click();
    URL.revokeObjectURL(url);
    toast('Downloaded ' + getExportFilename('docx'));
  }, [markdown, title, date, attendees, getExportFilename, toast]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-gray-200">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={handleCopyMarkdown} className="px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">
          Copy Markdown
        </button>
        <button type="button" onClick={handleDownloadDocx} className="px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">
          Download .docx
        </button>
      </div>
      <div className="flex items-center gap-2">
        {quality && <QualityBadge quality={quality} />}
        <button type="button" onClick={onNewSummary} className="px-3.5 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
          New Summary
        </button>
      </div>
    </div>
  );
}
