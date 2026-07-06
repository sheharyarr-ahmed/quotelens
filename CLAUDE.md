# QuoteLens — project instructions

Cross-platform (iOS + Android) AI quoting app for trades. **SPEC.md is the single source of truth** for all architecture decisions — read it before changing anything; the spec-reviewer agent (`.claude/agents/spec-reviewer.md`) reviews diffs against it and flags hard-invariant violations.

## Current state (after session 1, 2026-07-06)

Monorepo scaffold + complete backend pipeline, all running against **mocked services**. No Supabase project or Anthropic key exists yet: everything reads env vars (`.env.example` documents them), and `supabase/migrations/` are written but **not applied**. Multi-agent adversarial review completed; all confirmed findings fixed.

Remaining work, in intended order:
1. Create the Supabase project, apply migrations, fill `.env` (ask the user for keys — do not invent them).
2. Real integration runs: Anthropic vision/text nodes, faster-whisper transcription.
3. Mobile screens/hooks: capture session, live-assembly review screen (Reanimated, driven by real `quote_events`), trace viewer, magic-link auth.
4. Web quote page logic + Accept flow + Playwright tests.
5. EAS production AAB + Play submission; README + 90-second demo video.

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

## Hard rules

- **Commit messages must contain no AI-attribution strings** (no Co-Authored-By: Claude, no "Generated with", no robot emoji). `.githooks/commit-msg` rejects them — do NOT append the default Claude Code trailer.
- Mandatory photo citations, no invented prices, bounded retry, live assembly from real events, RLS everywhere — see the spec-reviewer agent for the full invariant list.
- Commit in small steps, each leaving verify.sh green.
- Service-role DB access must scope every query by the verified `user_id` and assert parent-row/storage-path ownership (RLS is bypassed on that path).
