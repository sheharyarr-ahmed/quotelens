# QuoteLens — project instructions

Cross-platform (iOS + Android) AI quoting app for trades. **SPEC.md is the single source of truth** for all architecture decisions — read it before changing anything; the spec-reviewer agent (`.claude/agents/spec-reviewer.md`) reviews diffs against it and flags hard-invariant violations.

## Current state (after session 2, 2026-07-06)

Monorepo scaffold + complete backend pipeline (session 1, mocked; multi-agent adversarial review completed, all confirmed findings fixed). Session 2 stood up the real infrastructure: hosted Supabase project `quotelens` (ref `nxuchpuslgkuawfliqsj`, ap-northeast-1, Postgres 17) is linked (`supabase/config.toml`), both migrations are **applied and verified remotely** (9 tables all RLS-enabled, 34 policies, seeded price books, private `captures` bucket). Root `.env` (gitignored) is fully populated with verified keys: Supabase URL/anon/service-role, JWT secret (validates the project's JWTs via raw UTF-8 HMAC), and a working Anthropic key. The `claude-*-latest` aliases never existed on the API; model ids are pinned to `claude-sonnet-5` (vision) and `claude-haiku-4-5-20251001` (text). No real API/pipeline run has happened yet.

Remaining work, in intended order:
1. Real integration runs: Anthropic vision/text nodes, faster-whisper transcription.
2. Mobile screens/hooks: capture session, live-assembly review screen (Reanimated, driven by real `quote_events`), trace viewer, magic-link auth.
3. Web quote page logic + Accept flow + Playwright tests.
4. EAS production AAB + Play submission; README + 90-second demo video.

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
