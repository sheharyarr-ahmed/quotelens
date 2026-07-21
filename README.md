# QuoteLens

AI quoting for trades. Walk a job site, photograph the work area, record a
spoken walkthrough, and an agent pipeline returns an itemized, evidence-cited
estimate before you leave the driveway. Every line item cites a photo the vision
model actually analyzed, every price comes from a seeded price book (never
invented), and the quote streams into the review screen line by line as the
pipeline emits it.

Portfolio project by Shery Labs. Source is public; the app is demonstrated in
screenshots of a real run and through one live hosted web quote. It is not
distributed through an app store. See [Scope and honesty](#scope-and-honesty).

**Live web sample:** https://quotelens-ten.vercel.app/q/sample-water-damaged-bedroom
&nbsp;(a real quote rendered server-side from hosted Supabase, no login)

![A completed QuoteLens quote: five line items, each carrying photo citations, one flagged inferred and one flagged unpriced](docs/screenshots/06-quote-completed.png)

---

## What it does

1. **Sign in** with a passwordless 6-digit email code.
2. **Create a job** (client, trade / price book) and drop into a walk-and-talk
   capture: one continuous audio recording runs while you snap photos, each
   uploading eagerly to private storage.
3. **Generate.** The backend transcribes the audio, runs vision on each photo,
   extracts tasks from the narration, matches them to the price book, drafts
   line items, and validates them.
4. **Watch it assemble live.** Line items slide into the review screen as the
   pipeline drafts them, each with its photo thumbnail attaching and the running
   total ticking up. If validation fails, the drafted rows visibly retract and
   the corrected items stream in fresh.
5. **Edit and send.** Adjust quantities and prices inline; edits sync across
   devices in under two seconds. Send opens the native share sheet with a public
   quote link.
6. **The client accepts.** The share link renders the quote in any browser with
   no login; the Accept action persists and an Accepted banner syncs back into
   the app.

## Architecture

Monorepo, one commit history, one verification gate.

| Package | Stack | Role |
|---|---|---|
| `mobile/` | Expo SDK 57, React Native 0.86, TypeScript strict, expo-router | Capture, live-assembly review, editing, trace viewer |
| `web/` | Next.js 16 App Router, React 19 | Public client quote page and Accept action |
| `backend/` | FastAPI, LangGraph, Python 3.12 (uv) | The seven-node agent pipeline |
| `supabase/` | Postgres 17, Storage, Realtime, Auth | Data, media, realtime transport, auth (RLS on every table) |
| `schema/` | JSON Schema artifact | Generated from the Pydantic models; the Zod mirror is tested against it |

**Data flow.** Photos and audio upload directly from the phone to a private
Supabase Storage bucket under row-level-security-scoped paths. The mobile app
sends its Supabase JWT to FastAPI, which verifies the signature against the
project JWKS and acts through the service role with every query scoped to the
verified user. Nothing large is proxied through the API on the client path; the
pipeline fetches media server-side from signed URLs. Realtime rides Supabase
`postgres_changes` on four tables: `quote_events` (live assembly), `agent_traces`
(stage ticker), `quotes` (status and Accepted sync), and `quote_line_items`
(cross-device edit sync), so a second device updates without FastAPI in the loop.

## The seven-node pipeline

`transcribe` and `analyze_photos` fan out in parallel from the entry point and
join at `parse_walkthrough`. Validation failures loop back to `draft_line_items`
with a hardcoded cap. On regenerate, the entry router skips straight to
`parse_walkthrough` using the cached transcript and observations, so a
regenerate never re-pays transcription or vision.

```mermaid
flowchart TD
  S((start)) -->|new capture| T[transcribe]
  S -->|new capture| A[analyze_photos]
  S -.->|regenerate: cached transcript + observations| P
  T --> P[parse_walkthrough]
  A --> P
  P --> M[match_pricebook]
  M --> D[draft_line_items]
  D --> V{validate}
  V -->|no errors| C[compile_quote]
  V -->|errors, retry_count &lt; 2| D
  V -->|retry cap reached| F((failed, draft kept))
  C --> Done((completed))
```

| Node | Model | Output |
|---|---|---|
| `transcribe` | faster-whisper (in-process, int8) | narration transcript |
| `analyze_photos` | Claude Sonnet vision (one call per photo) | per-photo observations tagged with photo IDs |
| `parse_walkthrough` | Claude Haiku | tasks extracted from the transcript |
| `match_pricebook` | Claude Haiku | an existing price-book item ID or null per task |
| `draft_line_items` | Claude Haiku | line items with quantities, prices, citations |
| `validate` | pure code, no LLM | schema + citation cross-check; fires the retry edge |
| `compile_quote` | pure code, no LLM | the final quote, re-validated |

Every node writes an `agent_traces` row (input, output, duration, and token
counts for the LLM nodes), which drives both the review screen's stage ticker and
the trace viewer.

## Hard invariants

These are the lines the project is built to defend, enforced mechanically rather
than by prompt.

- **Mandatory photo citations.** `QuoteLineItem.photo_citations` is non-empty by
  schema constraint (`backend/app/pipeline/schemas.py`), and `validate`
  cross-checks every cited photo ID against the set `analyze_photos` actually
  observed (`backend/app/pipeline/nodes/validate.py`). A line with an empty or
  unknown citation fails validation and never reaches the UI.
- **No invented prices.** `match_pricebook` is schema-constrained to an existing
  item ID or null; any ID not in the book is dropped to null
  (`backend/app/pipeline/nodes/match_pricebook.py`). Unmatched work renders as
  `unpriced` ("To be quoted"), never a guessed number.
- **Bounded self-correction.** The retry edge loops `validate` back to
  `draft_line_items` with `retry_count < 2` hardcoded
  (`backend/app/pipeline/nodes/validate.py`). Cap exhaustion leaves the quote
  `failed` with the last draft preserved and a Regenerate action available.
- **RLS everywhere.** Row-level security is enabled on all nine tables
  (`supabase/migrations/`), and the service-role backend scopes every query by
  the verified user and asserts parent-row ownership on the paths where RLS is
  bypassed.
- **Live assembly from real events.** The animation is driven by real pipeline
  events persisted to `quote_events`, not a staged replay over a finished quote.
  The trace timeline aligns with what the UI showed, including the retry
  retraction.

## Data model

Nine tables, RLS on every one: `profiles`, `price_books`, `price_book_items`,
`jobs`, `captures`, `quotes`, `quote_line_items`, `quote_events`,
`agent_traces`. `quote_events`, `quote_line_items`, `quotes`, and `agent_traces`
are in the Supabase realtime publication. The quote schema is a committed JSON
Schema artifact (`schema/quote.schema.json`) generated from the Pydantic models;
a backend test fails on drift and a mobile test asserts the Zod mirror matches it
field for field.

## Running it locally

**Prerequisites:** Node with `pnpm`, Python 3.12 with `uv`, a Supabase project,
an Anthropic API key.

```bash
# 1. Install JS workspaces from the repo root (.npmrc pins node-linker=hoisted).
pnpm install

# 2. Activate the committed git hooks (rejects generator trailers in messages).
git config core.hooksPath .githooks

# 3. Configure env: copy the template and fill in your values.
cp .env.example .env      # see the file for every variable and what reads it
set -a && source .env && set +a

# 4. Backend (FastAPI + pipeline). Each step below runs from the repo root.
uv sync --project backend
uv run --project backend uvicorn app.main:app --port 8000

# 5. Mobile (Expo). Press i for the iOS simulator, or scan the QR in Expo Go.
pnpm -C mobile expo start

# 6. Web (public quote page).
pnpm -C web dev
```

The database schema and seed data live in `supabase/migrations/` (apply with the
Supabase CLI). Email sign-in needs custom SMTP configured on the project
(`backend/scripts/configure_email_smtp.py`); without it, mint a code with
`backend/scripts/mint_login_code.py`. To render a stable public sample quote for
the web page, run `backend/scripts/seed_web_sample.py`. All three demo scripts
act on the account named by `QUOTELENS_DEMO_EMAIL` (or `--email`), and refuse to
run without one, so a clone never writes into somebody else's project.

### Verification

```bash
bash .claude/verify.sh          # backend pytest, mobile tsc, eslint, jest
pnpm -C web typecheck           # web type check
cd web && set -a && source ../.env && set +a && pnpm test:e2e   # web Playwright E2E
```

The backend tests cover the hard invariants directly: an uncited line item is
rejected, a citation naming an unobserved photo is rejected, the retry edge
fires on a seeded invalid draft and succeeds on the second pass, the cap halts
at two with the draft preserved, regenerate reuses the cached transcript and
observations, and the Pydantic schema regenerates byte-identical to the
committed artifact.

To reproduce the screenshot walkthrough yourself, including the forced retry
retraction, see [`docs/SCREENSHOT_RUNBOOK.md`](docs/SCREENSHOT_RUNBOOK.md).

## Screenshots

One run on an iPhone 17 Pro simulator against live services: real Anthropic
vision and text models, faster-whisper transcription, hosted Supabase, and the
deployed Vercel quote page. The pipeline completed in 49.2 seconds. Full set in
[`docs/screenshots/`](docs/screenshots/).

| | |
|---|---|
| ![Seven-stage pipeline ticker, three stages complete](docs/screenshots/03-stage-ticker.png) | ![Line items streaming in with the subtotal mid-roll](docs/screenshots/04-live-assembly.png) |
| **Pipeline ticker.** Driven by real `agent_traces` inserts, not a timer. | **Live assembly.** Rows arrive as the pipeline emits them; the subtotal is caught mid-roll at $853.74. |
| ![Drafted rows dimmed with struck-through totals under a Revising draft banner](docs/screenshots/05-retry-retraction.png) | ![Agent trace listing pipeline nodes with durations and token counts](docs/screenshots/13-agent-trace.png) |
| **Retry retraction.** One validation failure is deliberately seeded for the demo (`QUOTELENS_FORCE_RETRY=1`); the retraction, retry and re-draft that follow are the real code path. | **Agent trace.** Every node with its real duration and token counts. The list accumulates every attempt made against the quote, including two runs that died on a network timeout before the successful one. |

The quoting pipeline is what these show. The capture UI is not pictured: the iOS
simulator has no camera, so the walkthrough seeds its photos and narration from
the committed fixtures and runs the real pipeline over them. The capture upload
path (direct-to-Storage upload, metadata registration, RLS-scoped signed URLs) is
covered by `mobile/scripts/live-verify.ts`. The capture screen's rendering is not
covered by a test, and this walkthrough does not prove it. Generation here is
also triggered by `backend/scripts/seed_live_demo.py` calling the graph directly
rather than by the app's Generate button, so the app to `POST /generate` hop is
covered by `live-verify.ts` and the backend tests instead of by these images.

## Limitations

Each with its upgrade path.

- **Fire-and-forget generation.** The app subscribes to realtime after triggering
  generation; there is no background job queue. Upgrade path: a durable worker
  (for example Celery or a Supabase queue) for retries and horizontal scale.
- **No payments.** Accept records agreement only. Upgrade path: a Stripe deposit
  flow off the accepted event.
- **No offline capture.** A session requires connectivity. Upgrade path: a local
  capture queue that drains when the connection returns.
- **Seeded price books, no learning.** Prices come from seeded books and the app
  never invents one. Upgrade path: per-account price-book editing and import.
- **Backend runs locally, not hosted.** The demo runs FastAPI on localhost; only
  the web quote page is hosted (Vercel), reading hosted Supabase directly. Upgrade
  path: containerize and deploy the API (for example Railway or Render) with
  managed transcription.
- **Neither Android nor a physical iPhone is tested on device.** The same Expo
  code targets both, with no platform-forked screens, but the walkthrough runs on
  the iOS simulator and no device pass has been done. Upgrade path: an Android and
  iPhone device pass, and a Play listing if distribution is ever pursued.
- **The demo runs on a simulator, so capture media is seeded.** The simulator has
  no camera and the app has no photo-library fallback, so the walkthrough seeds
  the committed fixture photos and voice note and then runs the real pipeline over
  them. Everything downstream of capture is genuine. The capture upload path is
  covered by `live-verify.ts`, but the capture screen's rendering is not proven by
  the walkthrough or by any test. Upgrade path: a pass on a physical iPhone, which
  needs a network that does not isolate clients from each other.
- **Cross-device realtime sync is verified, not pictured.** Editing a quote on one
  device updates a second device in under two seconds; that is asserted by
  `mobile/scripts/live-verify.ts` against live services rather than shown in a
  screenshot, because two simulators photograph almost identically. Upgrade path:
  a recorded two-device pass once device testing happens.
- **Transcription is demo-grade.** faster-whisper `small` locally; a deployed free
  tier would use `base`. Upgrade path: managed transcription for production.
- **Light theme only.** Single palette. Upgrade path: a dark palette off the
  existing token module.

## Scope and honesty

QuoteLens ships as a portfolio package: this public repository, a screenshot
walkthrough of a real run, and one live hosted web quote sample. It is
deliberately not distributed through the Apple App Store or Google Play. The
backend runs locally for the demo; the client quote page is the only hosted
surface. The walkthrough is captured on the iOS simulator with fixture-seeded
capture media, so the capture screen is the one part of the app it does not
show, and no build has been tested on a physical device. There are no paying
users and no client traction claimed. That is the claim in full: source public,
demonstrated in screenshots of a real run, one live web sample.

## Ownership

Portfolio project by Shery Labs. All rights reserved; no license is granted for
reuse or redistribution. The source is public to be read and evaluated.
