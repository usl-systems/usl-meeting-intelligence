# Decisions — Meeting Intelligence

Architectural decisions and the reasoning behind them. Written once, never deleted.

---

## 2025-04-05 — AI Model: Qwen 3 via OpenRouter (not Anthropic API)

**Decision:** Use Qwen 3 (`qwen/qwen3-235b-a22b`) through OpenRouter instead of the USL standard Anthropic API.

**Reason:** This is an internal tool with high-volume, low-complexity summarization calls. Qwen 3 via OpenRouter costs ~$0.05 per 60-minute transcript vs significantly more on Claude. The USL Architecture Standards allow model deviations when documented. The OpenRouter SDK uses the same API shape as OpenAI, keeping the integration simple.

---

## 2025-04-05 — No Database in v1

**Decision:** No Supabase, no database. All state lives in the browser session.

**Reason:** v1 is a paste-and-go internal tool. Persistent history, user accounts, and saved summaries are v1.5 scope. Adding a database now adds auth requirements, schema management, and deployment complexity with no v1 user value.

---

## 2025-04-05 — Model set to `qwen/qwen3.6-plus:free` in .env.local

**Decision:** The `.env.local` currently uses `qwen/qwen3.6-plus:free` instead of the PRD-specified `qwen/qwen3-235b-a22b`.

**Reason:** Free tier selected for initial development and testing to avoid burning credits. Should be switched to `qwen/qwen3-235b-a22b` before production deployment and prompt tuning in Phase 4.

---

## 2025-04-05 — Repo name: `usl-meeting-intelligence`

**Decision:** GitHub repo named `usl-meeting-intelligence` under personal account (`irewole2019`), not under `uslsystems` org.

**Reason:** Solo builder project. Can be transferred to the org repo later if needed.

---

## 2025-04-05 — Next.js 14.2.35 (not latest Next.js 15)

**Decision:** Scaffolded with `create-next-app@14` per the Build Sequence spec, which targets Next.js 14 App Router.

**Reason:** The PRD and Build Sequence were written for Next.js 14. Upgrading to 15 mid-build would introduce breaking changes (async request APIs, Turbopack defaults) with no v1 value. Stable and well-documented.
