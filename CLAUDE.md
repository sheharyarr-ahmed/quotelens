# QuoteLens — project instructions

Cross-platform (iOS + Android) AI quoting app for trades. **SPEC.md is the single source of truth** for all architecture decisions — read it before changing anything; the spec-reviewer agent (`.claude/agents/spec-reviewer.md`) reviews diffs against it and flags hard-invariant violations.

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
- Live end-to-end (needs uvicorn: `set -a && source .env && set +a && cd backend && uv run uvicorn app.main:app --port 8000`): `cd mobile && set -a && source ../.env && set +a && pnpm exec tsx scripts/live-verify.ts`
- **Screenshot walkthrough** (SPEC v1.5 checks 3 and 7) — simulator only, backend on localhost; full procedure in `docs/SCREENSHOT_RUNBOOK.md`. `mobile/.env` keeps `EXPO_PUBLIC_API_URL=http://localhost:8000`. Drive the pipeline with `QUOTELENS_FORCE_RETRY=1 uv run python scripts/seed_live_demo.py run <quote_id>` — the flag must be on **that** command, since the script calls `graph.invoke` in-process and never goes through uvicorn.
- Web E2E: `cd web && set -a && source ../.env && set +a && pnpm test:e2e` (Playwright seeds and removes its own rows; web tsc via `pnpm -C web typecheck`)
- Install JS deps from the **repo root** (`pnpm install`); `.npmrc` pins `node-linker=hoisted` (React Native requires it).
- Supabase CLI: run `set -a && source .env && set +a` first — the keychain credential from `supabase login` is corrupt on this machine, and `SUPABASE_ACCESS_TOKEN` from `.env` takes precedence over it.

## Hard rules

- **Commit messages stay tool-agnostic**: no generator trailers, no bot emoji. The history records what changed and why, not which editor typed it. `.githooks/commit-msg` enforces this (activate with `git config core.hooksPath .githooks`).
- Mandatory photo citations, no invented prices, bounded retry, live assembly from real events, RLS everywhere — see the spec-reviewer agent for the full invariant list.
- Commit in small steps, each leaving verify.sh green.
- Service-role DB access must scope every query by the verified `user_id` and assert parent-row/storage-path ownership (RLS is bypassed on that path).
