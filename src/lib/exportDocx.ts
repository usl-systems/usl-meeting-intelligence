/**
 * DOCX Export Utility
 *
 * Converts summary markdown into a structured .docx document.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
} from 'docx';
import type { MeetingMetadata } from '@/types';

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const CELL_MARGINS = { top: 80, bottom: 80, left: 120, right: 120 };

interface Section {
  heading: string;
  body: string;
}

function parseSections(markdown: string): Section[] {
  const parts = markdown.split(/^## /m).filter(Boolean);
  return parts.map((part) => {
    const newlineIndex = part.indexOf('\n');
    if (newlineIndex === -1) return { heading: part.trim(), body: '' };
    return {
      heading: part.slice(0, newlineIndex).trim(),
      body: part.slice(newlineIndex + 1).trim(),
    };
  });
}

function parseTableRows(body: string): string[][] {
  const lines = body.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return [];

  return lines
    .filter((l) => !/^[|\s-]+$/.test(l)) // Skip separator rows
    .map((line) =>
      line
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
    );
}

function createTableFromRows(rows: string[][]): Table {
  if (rows.length === 0) return new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('')] })] })], width: { size: 9360, type: WidthType.DXA } });

  const colCount = rows[0].length;
  const colWidth = Math.floor(9360 / colCount);
  const columnWidths = Array(colCount).fill(colWidth);

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths,
    rows: rows.map((row, rowIndex) =>
      new TableRow({
        children: row.map((cell) =>
          new TableCell({
            borders: CELL_BORDERS,
            margins: CELL_MARGINS,
            width: { size: colWidth, type: WidthType.DXA },
            shading: rowIndex === 0 ? { fill: 'E8F0FE', type: ShadingType.CLEAR } : undefined,
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: cell,
                    bold: rowIndex === 0,
                    font: 'Arial',
                    size: 20,
                  }),
                ],
              }),
            ],
          })
        ),
      })
    ),
  });
}

function bodyToParagraphs(body: string, sectionHeading: string): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];

  // Check if this section has a markdown table
  if (sectionHeading.includes('Next Steps') && body.includes('|')) {
    const tableRows = parseTableRows(body);
    if (tableRows.length > 0) {
      elements.push(createTableFromRows(tableRows));
      return elements;
    }
  }

  const lines = body.split('\n');
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) inList = false;
      continue;
    }

    // Bullet list items
    if (/^[-*]\s/.test(trimmed)) {
      inList = true;
      const text = trimmed.replace(/^[-*]\s+/, '');
      elements.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineFormatting(text),
          spacing: { before: 40, after: 40 },
        })
      );
      continue;
    }

    // Numbered list items
    if (/^\d+\.\s/.test(trimmed)) {
      inList = true;
      const text = trimmed.replace(/^\d+\.\s+/, '');
      elements.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineFormatting(text),
          spacing: { before: 40, after: 40 },
        })
      );
      continue;
    }

    // Blockquotes (quotes)
    if (trimmed.startsWith('>')) {
      const text = trimmed.replace(/^>\s*/, '');
      elements.push(
        new Paragraph({
          indent: { left: 480 },
          children: [
            new TextRun({ text, italics: true, font: 'Arial', size: 21, color: '444444' }),
          ],
          spacing: { before: 80, after: 80 },
        })
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      new Paragraph({
        children: parseInlineFormatting(trimmed),
        spacing: { before: 60, after: 60 },
      })
    );
  }

  if (elements.length === 0) {
    elements.push(new Paragraph({ children: [new TextRun({ text: body, font: 'Arial', size: 22 })] }));
  }

  return elements;
}

function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Simple bold parsing: **text** or __text__
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/);

  for (const part of parts) {
    if (/^\*\*(.+)\*\*$/.test(part) || /^__(.+)__$/.test(part)) {
      const inner = part.replace(/^\*\*|\*\*$|^__|__$/g, '');
      runs.push(new TextRun({ text: inner, bold: true, font: 'Arial', size: 22 }));
    } else if (part) {
      runs.push(new TextRun({ text: part, font: 'Arial', size: 22 }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text, font: 'Arial', size: 22 })];
}

export async function exportDocx(
  markdown: string,
  metadata?: MeetingMetadata
): Promise<Blob> {
  const sections = parseSections(markdown);
  const children: (Paragraph | Table)[] = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [
        new TextRun({
          text: metadata?.title || 'Meeting Summary',
          bold: true,
          font: 'Arial',
          size: 36,
        }),
      ],
      spacing: { after: 120 },
    })
  );

  // Date
  if (metadata?.date) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: metadata.date, font: 'Arial', size: 22, color: '666666' }),
        ],
        spacing: { after: 240 },
      })
    );
  }

  // Attendees
  if (metadata?.attendees?.length) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Attendees: ', bold: true, font: 'Arial', size: 22, color: '666666' }),
          new TextRun({ text: metadata.attendees.join(', '), font: 'Arial', size: 22, color: '666666' }),
        ],
        spacing: { after: 360 },
      })
    );
  }

  // Sections
  for (const section of sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({ text: section.heading, bold: true, font: 'Arial', size: 28 }),
        ],
        spacing: { before: 360, after: 180 },
      })
    );

    const sectionElements = bodyToParagraphs(section.body, section.heading);
    children.push(...sectionElements);
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 22 } },
      },
    },
    numbering: {
      config: [
        {
          reference: 'default-bullet',
          levels: [
            {
              level: 0,
              format: 'bullet' as const,
              text: '\u2022',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}
