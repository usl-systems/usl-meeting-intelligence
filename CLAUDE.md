# Meeting Intelligence

Internal transcript summarization tool that converts Microsoft Teams meeting transcripts into structured, high-quality summaries. Paste or upload a transcript, choose a meeting type, get a clean 8-section summary in seconds.

**Domain:** meeting.uslsystems.co

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Backend | Next.js API routes (serverless) |
| AI Model | Qwen 3 via OpenRouter API (`qwen/qwen3-235b-a22b`) |
| File Handling | In-memory only. No database in v1. No persistent storage. |
| Export | Markdown (native), DOCX (via `docx` library) |
| Hosting | Vercel |

## Key Rules

- **No database in v1.** All state lives in the browser session.
- **No auth in v1.** No login, no accounts, no persistent user state.
- **OpenRouter API key is server-only.** Never expose in client bundles. Use `OPENROUTER_` prefix (not `NEXT_PUBLIC_`).
- **Prompts live in the PRD.** Section 5 of `Meeting_Intelligence_PRD_v1.md` is the authoritative prompt source. Do not invent new prompts without logging the decision.
- **Three meeting templates only:** Sales Discovery, Customer Support, Internal Sync.
- **Eight output sections in fixed order:** Executive Summary, Key Decisions, Customer Needs/Pain Points, Objections/Risks/Open Questions, Next Steps, Key Quotes, Meeting Outcomes, Follow-Up Email Draft.
- **Map-reduce pipeline:** Convert -> Chunk (2000 tokens) -> Summarize each chunk -> Reduce to final output.
- **Follow USL naming conventions:** PascalCase components, kebab-case API routes, camelCase utilities, UPPER_SNAKE_CASE env vars.
- **Conventional commits:** `feat:`, `fix:`, `refactor:`, `chore:`, `docs:` with reason when non-obvious.

## Project Structure

```
/CLAUDE.md                  # This file
/context/                   # Shared context (state, decisions, conventions, people)
/docs/                      # PRD and reference documents
/src/app/                   # Next.js App Router pages and API routes
/src/app/api/chunk/         # Chunk summarizer endpoint
/src/app/api/summarize/     # Final reducer endpoint
/src/app/api/quality/       # Quality checker endpoint
/src/app/api/health/        # Health check endpoint
/src/components/            # Shared UI components
/src/lib/                   # Utilities (converter, chunker, pipeline, fileParser, exportDocx, qualityCheck)
/src/types/                 # TypeScript type definitions
```

## Current State

See [/context/state.md](context/state.md) for what is built, in progress, and next.

## Reference Documents

- `Meeting_Intelligence_PRD_v1.md` — Product requirements, output spec, prompts, scope
- `Meeting_Intelligence_BuildSequence_v1.md` — Session-by-session build guide
- `USL_Architecture_Standards.md` — Company-wide build standards
- `ONBOARDING.md` — New builder onboarding

## Ownership

| Domain | Owner |
|--------|-------|
| Full build (v1) | Solo builder |
| Scope decisions | PRD v1.0 is authoritative |
| Prompt changes | Log in Decision Log (end of BuildSequence doc) and in `/context/decisions.md` |
