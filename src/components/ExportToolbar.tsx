'use client';

import { useCallback, useState } from 'react';
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

function markdownToHtml(md: string): string {
  return md
    // Headers
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    // Italic
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Bullet lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // Table rows → simple text (Teams has limited table support)
    .replace(/^\|(.+)\|$/gm, (_, row) => {
      const cells = row.split('|').map((c: string) => c.trim()).filter(Boolean);
      return cells.join(' · ');
    })
    // Remove separator rows
    .replace(/^[-| ]+$/gm, '')
    // Tags like [Objection], [Risk], [Open Question]
    .replace(/\[(Objection|Risk|Open Question)\]/g, '<b>[$1]</b>')
    // Line breaks
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

function buildWebhookPayload(props: {
  markdown: string;
  title: string;
  date: string;
  attendees: string;
  meetingType: MeetingType;
  filename: string;
  asHtml?: boolean;
}) {
  return {
    meetingType: props.meetingType,
    title: props.title || 'Meeting Summary',
    date: props.date || new Date().toISOString().slice(0, 10),
    attendees: props.attendees ? props.attendees.split(',').map((a) => a.trim()).filter(Boolean) : [],
    markdown: props.asHtml ? markdownToHtml(props.markdown) : props.markdown,
    filename: props.filename,
  };
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
  const [sendingSharePoint, setSendingSharePoint] = useState(false);
  const [sendingTeams, setSendingTeams] = useState(false);

  const getExportFilename = useCallback(
    (ext: string) => {
      const d = date || new Date().toISOString().slice(0, 10);
      const prefix = meetingType === 'sales_discovery' ? 'SD' : meetingType === 'customer_support' ? 'CS' : 'IS';
      if (title) {
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `${prefix}-${slug}-${d}.${ext}`;
      }
      return `${prefix}-meeting-summary-${d}.${ext}`;
    },
    [date, title, meetingType]
  );

  const handleCopyMarkdown = useCallback(async () => {
    await navigator.clipboard.writeText(markdown);
    toast('Markdown copied to clipboard');
  }, [markdown, toast]);

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

  const handleSendToSharePoint = useCallback(async () => {
    const webhookUrl = process.env.NEXT_PUBLIC_MAKE_SHAREPOINT_WEBHOOK_URL;
    if (!webhookUrl) {
      toast('SharePoint webhook not configured', 'error');
      return;
    }
    setSendingSharePoint(true);
    try {
      // Generate .docx and convert to base64
      const metadata: MeetingMetadata = {};
      if (title) metadata.title = title;
      if (date) metadata.date = date;
      if (attendees) metadata.attendees = attendees.split(',').map((a) => a.trim()).filter(Boolean);
      const blob = await exportDocx(markdown, metadata);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const payload = {
        ...buildWebhookPayload({ markdown, title, date, attendees, meetingType, filename: getExportFilename('docx') }),
        fileBase64: base64,
        fileContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast('Sent to SharePoint');
      } else {
        toast(`SharePoint failed (${res.status})`, 'error');
      }
    } catch {
      toast('Failed to reach SharePoint webhook', 'error');
    } finally {
      setSendingSharePoint(false);
    }
  }, [markdown, title, date, attendees, meetingType, getExportFilename, toast]);

  const handleSendToTeams = useCallback(async () => {
    const webhookUrl = process.env.NEXT_PUBLIC_MAKE_TEAMS_WEBHOOK_URL;
    if (!webhookUrl) {
      toast('Teams webhook not configured', 'error');
      return;
    }
    setSendingTeams(true);
    try {
      const payload = buildWebhookPayload({ markdown, title, date, attendees, meetingType, filename: getExportFilename('md'), asHtml: true });
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast('Sent to Teams');
      } else {
        toast(`Teams failed (${res.status})`, 'error');
      }
    } catch {
      toast('Failed to reach Teams webhook', 'error');
    } finally {
      setSendingTeams(false);
    }
  }, [markdown, title, date, attendees, meetingType, getExportFilename, toast]);

  const sharepointConfigured = !!process.env.NEXT_PUBLIC_MAKE_SHAREPOINT_WEBHOOK_URL;
  const teamsConfigured = !!process.env.NEXT_PUBLIC_MAKE_TEAMS_WEBHOOK_URL;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-gray-200">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={handleCopyMarkdown} className="px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">
          Copy Markdown
        </button>
        <button type="button" onClick={handleDownloadDocx} className="px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">
          Download .docx
        </button>
        {sharepointConfigured && (
          <button
            type="button"
            onClick={handleSendToSharePoint}
            disabled={sendingSharePoint}
            className="px-3.5 py-2 text-sm font-medium border border-blue-300 rounded-lg text-blue-700 hover:bg-blue-50 disabled:opacity-50 transition-colors"
          >
            {sendingSharePoint ? 'Sending...' : 'Send to SharePoint'}
          </button>
        )}
        {teamsConfigured && (
          <button
            type="button"
            onClick={handleSendToTeams}
            disabled={sendingTeams}
            className="px-3.5 py-2 text-sm font-medium border border-purple-300 rounded-lg text-purple-700 hover:bg-purple-50 disabled:opacity-50 transition-colors"
          >
            {sendingTeams ? 'Sending...' : 'Send to Teams'}
          </button>
        )}
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
