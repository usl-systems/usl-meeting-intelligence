# Conventions — Meeting Intelligence

Project-specific patterns and naming rules. Follows USL Architecture Standards unless noted.

## File and Folder Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| React components | PascalCase | `SummaryDisplay.tsx`, `QuotePanel.tsx` |
| API route folders | kebab-case | `src/app/api/chunk/route.ts` |
| Utility modules | camelCase | `src/lib/converter.ts`, `src/lib/pipeline.ts` |
| TypeScript types | PascalCase | `MeetingType`, `ChunkSignals`, `MeetingSummary` |
| Custom hooks | useCamelCase | `useTranscript`, `useSummary` |
| Environment variables | UPPER_SNAKE_CASE | `OPENROUTER_API_KEY` |

## API Routes

All API routes are Next.js App Router route handlers at `src/app/api/[name]/route.ts`:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/chunk` | POST | Summarize a single transcript chunk |
| `/api/summarize` | POST | Final reducer — consolidate all chunks into 8-section output |
| `/api/quality` | POST | Quality check the final summary |
| `/api/health` | GET | Health check |

## Environment Variables

- `OPENROUTER_` prefixed variables are server-only. Never use `NEXT_PUBLIC_` for API keys.
- `NEXT_PUBLIC_` prefix is only for values safe to expose in the browser bundle.

## Commits

Format: `type: short description - reason if non-obvious`

Types: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`

## Meeting Templates

Three fixed template IDs used throughout the codebase:

- `sales_discovery`
- `customer_support`
- `internal_sync`

## Output Sections (fixed order)

1. Executive Summary
2. Key Decisions + Rationale
3. Customer Needs / Pain Points
4. Objections / Risks / Open Questions
5. Next Steps
6. Key Quotes
7. Meeting Outcomes
8. Follow-Up Email Draft
