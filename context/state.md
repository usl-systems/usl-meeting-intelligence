# State — Meeting Intelligence

Last updated: 2025-04-05

## What Is Done

- GitHub repo created and pushed (`irewole2019/usl-meeting-intelligence`)
- PRD v1.0 and Build Sequence v1.0 converted to markdown and committed
- `.gitignore` configured for Next.js project
- `.env.local` created with OpenRouter API key, model, and app config
- `.env.local.example` committed as safe template for onboarding
- Architecture Standards and Onboarding docs in repo
- Context files created (CLAUDE.md, state, decisions, conventions, people)
- **Phase 0, Session 1 complete:** Next.js 14 scaffolded with App Router, TypeScript, Tailwind CSS, `src/` directory structure
  - Dev server confirmed working (localhost:3000 returns 200)
  - `src/lib/`, `src/types/`, `docs/` directories created
  - Next.js 14.2.35, React, PostCSS, ESLint installed
- **Phase 0, Session 2 complete:** Dependencies installed and TypeScript types defined
  - Packages: mammoth, webvtt-parser, docx, tiktoken, openai, react-markdown, remark-gfm
  - Types in `src/types/index.ts`: MeetingType, MeetingMetadata, ChunkSignals, MeetingSummary, QualityResult
  - `npm run build` passes with zero errors
- **Phase 1, Session 1 complete:** Markdown converter and chunker built
  - `src/lib/converter.ts` — detects and handles VTT, speaker-labeled, raw paragraph formats; strips filler words; normalizes speaker names
  - `src/lib/chunker.ts` — splits at speaker boundaries, never mid-sentence, 100-token overlap, uses tiktoken (cl100k_base)
  - Jest test suite with 5 passing tests in `src/lib/__tests__/converter.test.ts`
- **Phase 1, Session 2 complete:** Chunk summarizer API route built
  - `src/app/api/chunk/route.ts` — POST endpoint calling OpenRouter with chunk summarizer prompt
  - Returns `{ signals: ChunkSignals }` on success, `{ error, detail }` on failure
  - 30s timeout, max_tokens 1500, strips markdown fences from response
- **Phase 1, Session 3 complete:** Final reducer API route and pipeline orchestrator built
  - `src/app/api/summarize/route.ts` — POST endpoint calling OpenRouter with final reducer prompt, returns `{ markdown }`, 3000 max_tokens, 60s timeout
  - `src/lib/pipeline.ts` — orchestrates convert -> chunk -> /api/chunk (500ms delays) -> /api/summarize, exposes `onProgress` callback for UI
- **Phase 1, Session 4 complete:** Quality checker API route and rule-based pre-check built
  - `src/lib/qualityCheck.ts` — rule-based pre-check catches missing sections, short output, excessive TBDs without model call
  - `src/app/api/quality/route.ts` — POST endpoint, runs pre-check first, calls OpenRouter for deeper review if no high-severity issues, merges and deduplicates results
- **Phase 2, Session 1 complete:** Input page and template selector built
  - `src/app/page.tsx` — single-column layout with transcript textarea, file upload, 3 meeting type chips, collapsible metadata/chat sections, Generate button wired to pipeline
  - `next.config.mjs` — enabled asyncWebAssembly for tiktoken WASM support
  - `src/app/layout.tsx` and `globals.css` — cleaned up for Meeting Intelligence branding
- **Phase 2, Session 2 complete:** Summary display and quote panel built
  - Split view: 60% rendered markdown (react-markdown + remark-gfm + prose typography), 40% Key Quotes panel
  - Quote cards parsed from markdown with speaker/timestamp, blue left border
  - Quality badge (green/amber/red) with score, high-severity warning banner
  - Loading state with spinner, progress bar, chunk progress message
  - Quality checker wired: POST /api/quality called after pipeline completes
- **Phase 2, Session 3 complete:** Export functions built
  - Export toolbar with 4 buttons: Copy Markdown, Download .md, Download .docx, Copy Email
  - `src/lib/exportDocx.ts` — structured DOCX export with headings, tables, bullet lists, metadata
  - Clipboard buttons show "Copied!" for 2 seconds, downloads use `meeting-summary-YYYY-MM-DD` naming
- **Phase 2, Session 4 complete:** End-to-end smoke test passed with prompt rewrite
- **Phase 3, Session 1 complete:** File parsing wired into UI
  - `src/lib/fileParser.ts` — parses .vtt (speaker labels + timestamps), .txt (raw), .docx (mammoth)
  - File upload populates transcript textarea, shows "Reading file..." while parsing, inline error on failure
- **Phase 4, Session 1 complete:** Error handling and resilience
  - Chunk retry with 2s delay, skip on second failure with UI warning
  - Malformed reducer output shown with warning banner instead of crash
  - Transcript length check with inline warning at 120k chars
  - API key check on load via /api/health, disables Generate if missing
  - Network offline detection with "check your connection" message, form state preserved
  - Pipeline returns `{ markdown, warnings }` instead of raw string
- **Phase 5, Sessions 1-2 complete:** Deployed to production
  - Live at https://meeting.uslsystems.co
  - Repo moved to https://github.com/usl-systems/usl-meeting-intelligence
- **Phase 5, Session 3 complete:** Production hardening
  - Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `poweredByHeader: false`
  - `public/robots.txt` disallows all crawlers
  - Rate limiting on `/api/summarize`: 10 requests per IP per hour (in-memory)
  - `/api/health` endpoint (already existed from Phase 4)
  - Client bundle verified: no API key values exposed (only config instruction string)

## Pre-Build Checklist Status

- [x] Claude Code installed and working
- [x] OpenRouter account created
- [x] OpenRouter API key generated and stored in `.env.local`
- [x] Model set to Gemini 2.5 Flash (`google/gemini-2.5-flash`) via OpenRouter
- [x] GitHub repository created and pushed
- [x] Vercel account created and connected to GitHub
- [x] Node.js v22.14.0 confirmed
- [x] npm 11.9.0 confirmed
- [ ] DNS access to uslsystems.co confirmed
- [x] Test .vtt transcript files available
- [ ] Test .txt transcript file collected
- [ ] Test .docx transcript file collected
- [ ] Test Teams chat export collected

## v1.1 Improvements (see docs/v1.1-improvements.md)

- **Wave 1 complete:** Quality checker fix, document naming, New Summary button, scroll to summary
  - Quality checker rewrote section extraction, recalibrated scoring (95 base), 8 tests passing
  - Exports use title slug or meeting type for filenames
- **Wave 2 complete:** Adaptive caps, email draft panel, component extraction
  - Prompt caps scale with chunk count (short: 3 bullets/3 decisions, long: 8/8)
  - `EmailDraftPanel` component with blue highlight and copy button
  - Extracted `ExportToolbar`, `QuotePanel`, `LoadingState` — page.tsx from 660 to 280 lines

- **Wave 3 complete:** UX polish
  - Drag-and-drop file upload with visual drop zone feedback
  - Toast notification system (success/error/warning) replacing inline confirmations
  - Streaming progress messages ("Analyzing decisions...", "Extracting quotes...")
  - Editable summary: toggle to raw markdown, edit, save, then export
  - Meeting type auto-detection from transcript keywords (sales/support/internal signals)
  - Summary history in localStorage (last 10), accessible via header dropdown

## What Is Next

1. **Wave 4:** Power Automate webhook integration
2. Prompt tuning against more real transcripts (2.4)
3. v1.5: Company knowledge integration (see docs/company-knowledge-roadmap.md)
