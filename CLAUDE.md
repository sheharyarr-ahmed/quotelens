# QuoteLens — project instructions

Cross-platform (iOS + Android) AI quoting app for trades. **SPEC.md is the single source of truth** for all architecture decisions — read it before changing anything; the spec-reviewer agent (`.claude/agents/spec-reviewer.md`) reviews diffs against it and flags hard-invariant violations.

## Current state (after session 5, 2026-07-09)

Monorepo scaffold + complete backend pipeline (session 1, mocked; adversarial review done). Session 2 stood up real infra: hosted Supabase project `quotelens` (ref `nxuchpuslgkuawfliqsj`, ap-northeast-1, Postgres 17) linked, both migrations applied/verified remotely (9 tables RLS-enabled, seeded price books, private `captures` bucket), root `.env` (gitignored) fully populated with verified keys. Model ids pinned to `claude-sonnet-5` (vision) and `claude-haiku-4-5-20251001` (text).

Session 3 completed the **first real end-to-end integration run**: `backend/scripts/integration_run.py` (idempotent setup: test user `integration-test@quotelens.dev`, reused job, fixture media in `backend/tests/fixtures/`) drives `graph.invoke` with `build_services_from_env()` and asserts all hard invariants against the live DB — all pass, twice. Real Sonnet 5 vision + Haiku text + whisper-small transcription (~35s/run, ~11k tokens). Key fix: all four LLM calls now use **structured outputs** (`output_config.format` json_schema; per-node `RESPONSE_SCHEMA` beside each prompt) because Sonnet 5 wraps bare-prompt JSON in markdown fences; draft schema stays looser than `QuoteLineItem` so `validate` keeps owning the citation invariant/retry edge. `_parse` fails loudly on `stop_reason != end_turn`.

Session 4 ran the `/spec` mobile UI/UX interview and amended SPEC.md to **v1.3** — see its new "Mobile UI/UX" Decisions section for every settled screen/animation/state decision (jobs-first nav, walk-and-talk capture, agent_traces stage ticker, email OTP auth, StyleSheet tokens light-only, etc.). All mobile screens were then implemented (commits through fbdd8f9).

Session 5 (2026-07-08/09) finished steps 1 and 2. **Mobile live verification**: `mobile/scripts/live-verify.ts` (run: `cd mobile && set -a && source ../.env && set +a && pnpm exec tsx scripts/live-verify.ts`; uvicorn must be up) drives the screens' exact data paths against live services — 68 checks green (realtime live assembly in emission order, subscribe-first catch-up, <2s cross-device sync, RLS incl. realtime spies, cached regenerate, trace grouping). It exposed and fixed two real backend bugs: hosted-project JWTs are **ES256** (signing keys) — `auth.py` now verifies via project JWKS (certifi ssl_context; HS256 legacy fallback; JWKS outage → 503); and `/regenerate` never flipped status — it now marks `generating` pre-schedule and 409s unless status is completed/failed (an accepted quote must never be silently erased). **Web (step 2)**: `q/[shareToken]` renders server-side via service role scoped strictly by `share_token` (no photos by decision); `POST /api/accept` flips `sent`→`accepted` via conditional UPDATE (exactly one winner writes the single `quote_accepted` event; idempotent; 409 otherwise); migration 4 adds a partial unique index backstopping one accept event per quote (applied remotely). Playwright 5/5 against the live project: `cd web && set -a && source ../.env && set +a && pnpm test:e2e`.

**Open blocker — email OTP delivery (owner decision pending)**: hosted Supabase locks email-template editing AND the 2-emails/hour built-in send cap behind **custom SMTP** (dashboard grays the editors; Management API PATCH → 403), and `mailer_otp_length` is 8 while the app accepts 6 — so the sign-in email carries a link, never a typable code (SPEC v1.3.1 records the constraint). Until SMTP lands, mint codes with `cd backend && set -a && source ../.env && set +a && uv run python scripts/mint_login_code.py [email]` (reach the app's code screen for that email first; each new request invalidates the prior code). Built-in SMTP also delivers only to project team-member addresses.

Remaining work, in intended order:
1. Unblock email login — Option A: set up custom SMTP now (Brevo recommended: free 300/day, no domain needed — verify the owner's gmail as sender, SMTP creds into the dashboard's "Set up SMTP", then paste code-only `{{ .Token }}` templates into Confirm signup + Magic Link and set Email OTP Length to 6); Option B: defer SMTP to milestone 3 and test with minted codes.
2. Milestone 3 — **run the `/spec` interview first** (backend production hosting — uvicorn is laptop-only today and a Play-installed app cannot reach it; web deploy target + `EXPO_PUBLIC_WEB_URL` for share links, currently defaulting to localhost:3000; SMTP provider recorded; Play listing; 90-second demo script), amend SPEC, then: EAS production AAB + Play submission, README, demo video, privacy-policy static page on web (`store/privacy-policy.md` exists).

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
- Web E2E: `cd web && set -a && source ../.env && set +a && pnpm test:e2e` (Playwright seeds and removes its own rows; web tsc via `pnpm -C web typecheck`)
- Install JS deps from the **repo root** (`pnpm install`); `.npmrc` pins `node-linker=hoisted` (React Native requires it).
- Supabase CLI: run `set -a && source .env && set +a` first — the keychain credential from `supabase login` is corrupt on this machine, and `SUPABASE_ACCESS_TOKEN` from `.env` takes precedence over it.

## Hard rules

- **Commit messages must contain no AI-attribution strings** (no Co-Authored-By: Claude, no "Generated with", no robot emoji). `.githooks/commit-msg` rejects them — do NOT append the default Claude Code trailer.
- Mandatory photo citations, no invented prices, bounded retry, live assembly from real events, RLS everywhere — see the spec-reviewer agent for the full invariant list.
- Commit in small steps, each leaving verify.sh green.
- Service-role DB access must scope every query by the verified `user_id` and assert parent-row/storage-path ownership (RLS is bypassed on that path).
