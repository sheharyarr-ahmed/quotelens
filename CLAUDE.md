# QuoteLens — project instructions

Cross-platform (iOS + Android) AI quoting app for trades. **SPEC.md is the single source of truth** for all architecture decisions — read it before changing anything; the spec-reviewer agent (`.claude/agents/spec-reviewer.md`) reviews diffs against it and flags hard-invariant violations.

## Current state (after session 3, 2026-07-07)

Monorepo scaffold + complete backend pipeline (session 1, mocked; adversarial review done). Session 2 stood up real infra: hosted Supabase project `quotelens` (ref `nxuchpuslgkuawfliqsj`, ap-northeast-1, Postgres 17) linked, both migrations applied/verified remotely (9 tables RLS-enabled, seeded price books, private `captures` bucket), root `.env` (gitignored) fully populated with verified keys. Model ids pinned to `claude-sonnet-5` (vision) and `claude-haiku-4-5-20251001` (text).

Session 3 completed the **first real end-to-end integration run**: `backend/scripts/integration_run.py` (idempotent setup: test user `integration-test@quotelens.dev`, reused job, fixture media in `backend/tests/fixtures/`) drives `graph.invoke` with `build_services_from_env()` and asserts all hard invariants against the live DB — all pass, twice. Real Sonnet 5 vision + Haiku text + whisper-small transcription (~35s/run, ~11k tokens). Key fix: all four LLM calls now use **structured outputs** (`output_config.format` json_schema; per-node `RESPONSE_SCHEMA` beside each prompt) because Sonnet 5 wraps bare-prompt JSON in markdown fences; draft schema stays looser than `QuoteLineItem` so `validate` keeps owning the citation invariant/retry edge. `_parse` fails loudly on `stop_reason != end_turn`.

Remaining work, in intended order:
1. Mobile screens/hooks: capture session, live-assembly review screen (Reanimated, driven by real `quote_events`), trace viewer, magic-link auth. **Before writing any screen code: run the `/spec` skill to interview the owner on the UI/UX (layouts, animation behavior, empty/error states, navigation) and amend SPEC.md with the settled decisions** (see SPEC.md - Repo and process). Implement against the amended spec.
2. Web quote page logic + Accept flow + Playwright tests.
3. EAS production AAB + Play submission; README + 90-second demo video.

## Layout

- `backend/` — FastAPI + LangGraph (Python 3.12, uv). Pipeline in `app/pipeline/` (seven nodes, bounded retry `retry_count < 2` hardcoded). Services injected via LangGraph runtime context (`app/services/bundle.py:Services`); tests use fakes from `tests/fakes.py`, never the network.
- `schema/quote.schema.json` — committed artifact generated from the Pydantic models. After any quote-model change: `cd backend && uv run python scripts/export_schema.py` and commit the diff. Pydantic is minor-pinned (`<2.14`) because the artifact test compares byte-identical.
- `mobile/` — Expo SDK 57 + expo-router, TypeScript strict, pnpm workspace. Zod 4 mirror in `src/lib/quote-schema.ts` (uses native `z.toJSONSchema()`, per SPEC v1.2.1).
- `web/` — Next.js 16 App Router (SPEC v1.2.1 amendment), client quote page only.
- `supabase/migrations/` — nine tables, RLS on every table (hard invariant).

## Commands

- Full gate: `bash .claude/verify.sh` (backend pytest, mobile tsc, mobile eslint, mobile jest). Run after every meaningful change; keep it green per commit.
- Backend only: `cd backend && uv run pytest -q`
- Mobile only: `cd mobile && pnpm exec tsc --noEmit && pnpm exec eslint . && pnpm exec jest`
- Install JS deps from the **repo root** (`pnpm install`); `.npmrc` pins `node-linker=hoisted` (React Native requires it).
- Supabase CLI: run `set -a && source .env && set +a` first — the keychain credential from `supabase login` is corrupt on this machine, and `SUPABASE_ACCESS_TOKEN` from `.env` takes precedence over it.

## Hard rules

- **Commit messages must contain no AI-attribution strings** (no Co-Authored-By: Claude, no "Generated with", no robot emoji). `.githooks/commit-msg` rejects them — do NOT append the default Claude Code trailer.
- Mandatory photo citations, no invented prices, bounded retry, live assembly from real events, RLS everywhere — see the spec-reviewer agent for the full invariant list.
- Commit in small steps, each leaving verify.sh green.
- Service-role DB access must scope every query by the verified `user_id` and assert parent-row/storage-path ownership (RLS is bypassed on that path).
