# QuoteLens · SPEC.md

Cross-platform (iOS + Android) AI quoting app for trades and field-service operators. Walk the job site, capture photos and a spoken narration, and an agent pipeline produces an itemized, evidence-cited estimate the operator reviews and sends before leaving the driveway. Portfolio project. Closes the React Native gap, ships as a published Google Play listing, and reuses the mandatory-citation and self-correcting state machine patterns already proven in the portfolio.

v1.3 of this spec. Changes from v1.2.1: the mobile UI/UX interview mandated by "Repo and process" ran on 2026-07-07 and its settled decisions are recorded in the new **Mobile UI/UX** section under Decisions. Structural consequences: navigation is jobs-first with no tab bar, auth completes via emailed one-time code instead of a deep-linked magic link, styling is a plain StyleSheet token module (light-only), the review screen's waiting state is driven by realtime `agent_traces` inserts (one small migration), and dark mode / manual line-item creation / pause-resume narration move to Out of scope.

Changes from v1.2: two tooling amendments — the mobile mirror test uses Zod 4's native `z.toJSONSchema()` (the `zod-to-json-schema` package named in v1.2 is unmaintained since Nov 2025), and the web app pins Next.js 16 LTS instead of 15 (Next 15 LTS reaches end of life Oct 2026, inside this project's public lifetime).

Changes from v1.1: scoping interview resolved eleven open implementation questions. The pipeline gains a dedicated analyze_photos vision node (seven nodes total), retry behavior in the live-assembly UI is specified as visible retraction, media uploads go direct to Supabase Storage, backend hosting and whisper sizing are pinned for the free-tier deploy, and price book matching, schema-mirror mechanics, realtime transport, API auth, failure state, and the pricing model are all decided below.

---

## Goal

A worker opens the app on any phone, photographs the work area, records a voice walkthrough, and taps Generate. The pipeline transcribes the audio, runs Claude vision on the photos, cross-references a seeded price book, and returns a structured quote: line items with quantity, unit price, total, at least one photo citation per line, and a confidence flag on any line the model inferred rather than heard. Line items stream into the review screen one by one as the pipeline emits them, each animating in with its photo thumbnail attaching. The worker edits inline, taps Send, and the client receives a web quote link with an Accept button that records acceptance.

Success is demonstrated end-to-end when:

1. The same codebase runs on an iOS simulator and a physical Android device with no platform-forked screens.
2. QuoteLens is live on Google Play as an installable public listing. iOS remains simulator-only, disclosed honestly in the README.
3. A real capture session for a painting job (3+ photos, 30 to 60 seconds of speech) produces a valid quote in under 90 seconds.
4. Every line item carries at least one photo citation, and every citation refers to a photo the vision node actually analyzed. A quote with an uncited line item fails schema validation and never reaches the UI.
5. Quote generation renders as live assembly: line items appear progressively with photo thumbnails attaching, driven by real pipeline events, not a fake staged animation over a finished result. If the retry edge fires, the UI shows it honestly: drafted items sweep into a dimmed revising state and the corrected items stream in fresh.
6. Editing a quote on one device updates the open quote screen on a second device via Supabase Realtime within 2 seconds.
7. The client quote page renders from a signed share link without authentication and the Accept action persists.
8. The agent trace screen shows every pipeline node with input, output, duration, and token count.
9. The 90-second demo video exists: one painter, one water-damaged bedroom, capture to sent quote, shot across an Android phone and an iOS simulator side by side.

Non-goals for success: App Store distribution, payment collection, offline-first sync, price learning. See Out of scope.

## Files

```
quotelens/
├── SPEC.md
├── README.md                          # architecture, honest limitations, Play Store link, demo GIF
├── schema/
│   └── quote.schema.json              # committed JSON Schema artifact, single source of truth
│                                      #   for the Pydantic/Zod mirror tests on both sides
├── .claude/                           # committed scaffold, same pattern as prior projects
│   └── verify.sh                      # backend pytest + mobile tsc + lint, gates the Stop hook
├── .githooks/
│   └── commit-msg                     # rejects AI-attribution strings
├── mobile/                            # React Native (Expo), TypeScript strict
│   ├── app/                           # expo-router screens (single stack, no tab bar — v1.3)
│   │   ├── (auth)/login.tsx           # passwordless email OTP (send code, enter 6-digit code)
│   │   ├── index.tsx                  # home: jobs list, each job shows its quote status
│   │   ├── job/new.tsx                # modal: job name + trade/price-book picker, lands in capture
│   │   ├── capture/[jobId].tsx        # walk-and-talk capture session, eager direct-to-Storage upload
│   │   ├── quote/[quoteId]/index.tsx  # review/edit screen, Realtime-subscribed, live assembly renderer
│   │   └── quote/[quoteId]/trace.tsx  # agent trace viewer
│   ├── src/
│   │   ├── api/                       # typed client for FastAPI endpoints
│   │   ├── components/                # QuoteLineItem, ConfidenceFlag, PhotoCitation,
│   │   │                              #   LiveAssemblyList (Reanimated), LineItemEditorSheet,
│   │   │                              #   StageTicker, PermissionGate
│   │   ├── hooks/                     # useCaptureSession, useQuoteAssembly (events reducer +
│   │   │                              #   stage ticker), useLineItemSync (cross-device edits)
│   │   └── lib/                       # supabase client (AsyncStorage-persisted session),
│   │                                  #   zod schemas mirrored from backend, theme.ts tokens
│   ├── __tests__/                     # schema mirror test vs schema/quote.schema.json, hook tests
│   ├── app.json                       # Play Store identity: package id, versionCode, adaptive icon
│   └── eas.json                       # EAS build profiles incl. production AAB for Play submission
├── backend/                           # FastAPI, Python 3.11+
│   ├── app/
│   │   ├── main.py
│   │   ├── routes/                    # /captures, /generate, /quotes, /health
│   │   ├── auth.py                    # Supabase JWT verification dependency
│   │   ├── pipeline/                  # the agent state machine
│   │   │   ├── graph.py               # node wiring, parallel entry fan-out, conditional retry edge
│   │   │   ├── nodes/                 # transcribe, analyze_photos, parse_walkthrough,
│   │   │   │                          #   match_pricebook, draft_line_items, validate, compile_quote
│   │   │   ├── events.py              # pipeline events -> quote_events rows feeding live assembly
│   │   │   └── schemas.py             # Pydantic models, citation constraint enforced here
│   │   ├── services/                  # transcription, claude client, storage, trace writer
│   │   └── db/                        # Supabase access layer (service role, user-scoped queries)
│   └── tests/                         # pipeline unit tests incl. forced-retry path, schema artifact test
├── web/                               # Next.js 16 App Router, client quote page only
│   ├── app/q/[shareToken]/page.tsx    # public quote view + Accept action
│   └── app/api/accept/route.ts
├── store/                             # Play Store listing assets
│   ├── listing.md                     # title, short + full description, category, contact
│   ├── screenshots/                   # phone screenshots per Play requirements
│   ├── feature-graphic/               # 1024x500, brand system
│   └── privacy-policy.md              # served as a static page on the web app
└── supabase/
    └── migrations/                    # tables: profiles, price_books, price_book_items,
                                       #   jobs, captures, quotes, quote_line_items,
                                       #   quote_events, agent_traces. RLS on every table.
                                       #   v1.3 adds: quote_events, quote_line_items, quotes,
                                       #   agent_traces in the supabase_realtime publication.
```

## Decisions

### Platform and distribution

- **React Native with Expo, not bare RN.** Expo Router, expo-camera, expo-av cover the full capture surface. EAS free tier builds both platforms and produces the production Android App Bundle for Play submission. Ejecting is a documented escape hatch, not a v1 need.
- **Google Play publication is in scope; Apple App Store is not.** One-time $25 Play developer fee is the single approved cash spend on this project, justified because a live store listing moves the project from "repo and video" to "installable product" and answers the store-link question mobile clients ask. Apple's $99/year fails the same cost-benefit test at portfolio stage. iOS ships as simulator demo, disclosed plainly. Play review lead time (several days to two weeks for new developer accounts, closed-testing requirements may apply) is treated as a schedule item, submission happens as soon as the manual E2E passes, not after polish.
- **Demo scope is the painting trade.** The demo video, the seeded default price book, the store screenshots, and the README hero all follow one painter through one water-damaged bedroom. One story demos stronger than a generic multi-trade pitch. HVAC and landscaping price book templates still ship as seed data to prove the pattern generalizes, but no demo asset features them.
- **Backend deploys to a free-tier host (Render, Fly, or Railway class), disclosed as a demo backend.** The only approved spend stays the $25 Play fee. Free tiers mean slow cold starts and modest RAM; the Play listing and the in-app empty state disclose "demo backend, may be paused" honestly rather than pretending production SLAs. The demo video is recorded against the local backend, where transcription runs at full quality. Alternatives considered: hosted transcription APIs (adds a paid dependency and revises the zero-API-spend rule), tunneled local backend (makes the public listing symbolic). Rejected in favor of a real public URL with honest disclosure.

### Pipeline

- **Pipeline is an explicit state machine with one bounded retry edge. Seven nodes: transcribe, analyze_photos, parse_walkthrough, match_pricebook, draft_line_items, validate, compile_quote.** transcribe and analyze_photos fan out in parallel from the entry point and join at parse_walkthrough. Validate failures loop back to draft_line_items with retryCount < 2 hardcoded. Implemented in LangGraph Python, putting the Python variant in the portfolio alongside the existing JS one.
- **analyze_photos is a dedicated vision node, not vision folded into drafting.** It runs Claude Sonnet vision once per photo (parallel calls), producing structured observations tagged with photo IDs: surfaces, damage, rooms, approximate dimensions. draft_line_items receives observations plus the parsed transcript and may only cite photo IDs present in the observation set; validate checks that every citation refers to an observed photo. This makes citations mechanically checkable instead of self-reported, fixes vision cost per capture (retries do not re-pay vision), and gives the trace screen a clean seeing-vs-drafting separation. Alternative considered: one multimodal draft call (fewer hops, but citations become self-reported by the same call that drafts, and every retry re-pays full vision cost).
- **Claude Haiku for parse_walkthrough, match_pricebook, and draft_line_items; Sonnet for analyze_photos.** Cheap path for text reasoning, stronger model where image understanding earns it. Every node writes to agent_traces.
- **match_pricebook is a single Haiku call with the full active price book in context.** Seeded books are small (roughly 40 to 80 items), so the whole book plus the parsed tasks fit one cheap call. Output is schema-constrained to either an existing price_book_item_id or null per task; null renders as `unpriced`. The model can only pick IDs that exist, so the no-invented-prices rule stays mechanical. Alternatives considered: embeddings plus a similarity threshold (adds an embedding pipeline and threshold tuning that demo scale never earns), fuzzy keyword match with LLM fallback (two matching code paths to test).
- **Transcription via faster-whisper in-process, model size set by WHISPER_MODEL env var, int8 compute.** Local dev and the demo video use `small` (best accuracy where it matters); the deployed free tier uses `base` (roughly 300MB, fits 512MB instances). Zero API spend, one code path. README names managed transcription as the production path and marks deployed transcription as demo-grade. Alternatives considered: `small` everywhere (couples the project to whichever host still gives 2GB free), `tiny` deployed (noticeably worse public experience).
- **Retry cap exhaustion leaves the quote in a `failed` status with the last draft kept visible.** The broken lines are flagged in a clearly-marked invalid state, and a Regenerate action re-runs the pipeline from the cached transcript and photo observations, so a regenerate never re-pays transcription or vision. The trace screen shows the halted run. Nothing the user captured is lost. Alternative considered: discarding the draft on failure (simpler UI, but throws away a mostly-good draft and hides the self-correction story).

### Quote schema and integrity

- **TypeScript strict on mobile and web, Pydantic v2 on backend, Zod mirrors of the quote schema on the client.**
- **The schema mirror is proven through a committed JSON Schema artifact at `schema/quote.schema.json`.** A backend test regenerates `model_json_schema()` from the Pydantic quote models and fails if it differs from the committed artifact (drift shows up as a red diff). A mobile test converts the hand-written Zod mirror via Zod 4's native `z.toJSONSchema()` and asserts field names, required sets, and enums match the same artifact. Each side runs in its own toolchain, which fits verify.sh's split gates. Alternatives considered: codegen Zod from Pydantic (stronger guarantee, but adds a build step and generated code is awkward to extend with client-only refinements), shared golden fixtures (tests behavior, can silently miss a renamed optional field).
- **Mandatory photo citations as a schema constraint, not a prompt instruction.** `QuoteLineItem.photo_citations` must be non-empty or validation fails and the retry edge fires. Validate additionally asserts every cited photo ID exists in the analyze_photos observation set. This is the line defended in vetting calls.
- **Confidence flag is a first-class field.** Any line item derived from inference rather than explicit narration is marked `confidence: "inferred"` and rendered with a visible flag. The model declaring uncertainty is a feature.
- **Price book items are per-unit: each item carries a unit (sqft, linear_ft, each, flat) and a unit price.** Example: "Interior wall paint, 2 coats, $1.80/sqft". draft_line_items sets quantity from the narration when stated ("the room is 12 by 14") and from vision dimension estimates otherwise, flagging those lines `inferred`. Realistic trade pricing, and quantity inference gives the confidence flag real work in every demo. Alternatives considered: flat task pricing (kills quantity errors but the inferred flag rarely fires and quotes look toy-like), hybrid flat-plus-extras (two pricing semantics in the schema for marginal demo gain).
- **Seeded price books, no learning.** Painting is the default and demo book; HVAC and landscaping ship as alternates. The app never invents a price absent from the book. Unmatched work renders as `unpriced` for manual entry rather than a guessed number.

### Realtime and live assembly

- **Live quote assembly is a product feature, not a demo trick.** The pipeline emits a per-line-item event as draft_line_items produces each entry. Events persist to quote_events and stream to the client. The review screen renders arrivals through a Reanimated list: item slides in, photo thumbnail attaches, running total ticks up. Hard rule: the animation is driven by real pipeline events. No staged fake over a finished quote, because the trace screen would expose the mismatch and the honesty of the pipeline is the selling point.
- **All realtime traffic rides Supabase postgres_changes, on two tables.** The backend inserts quote_events rows as the pipeline runs (event types: `line_item_drafted`, `retry_started`, `generation_completed`, `generation_failed`, `quote_accepted`); clients subscribe to postgres_changes on quote_events for live assembly and on quote_line_items for cross-device edit sync. Edits write directly from the device to Supabase under RLS, so device B updates without FastAPI in the loop. One mechanism, and events are durably persisted by construction, so the trace timeline aligns with what the UI showed. Alternative considered: Broadcast channel for assembly (lower latency, but a second mechanism plus a persist/broadcast consistency gap to keep honest).
- **When the retry edge fires, the UI shows it: visible retraction and re-stream.** The pipeline emits `retry_started`; the review screen sweeps the drafted items into a dimmed "revising" state, then the corrected items stream in fresh. Honest to the trace, and the self-correction becomes a visible product moment; the demo seeds one retry deliberately. Alternatives considered: per-item validation (never shows retractions, but restructures the whole-draft retry state machine), buffering events until validation passes (replay sits uncomfortably close to the staged-animation line).

### Mobile UI/UX (settled in the v1.3 interview, 2026-07-07)

**Navigation and structure**

- **Jobs-first single stack, no tab bar.** Home is the jobs list; each job card shows its quote status. "+ New job" opens a lightweight modal (job name + trade/price-book picker) that lands directly in the capture session. Quotes are reached through their job. The scaffold's `(tabs)` group collapses to a plain home route. Alternatives considered: a Quotes+Jobs tab bar (two entry points to the same data at demo scale), quotes-first with implicit auto-named jobs (hides a real data-model concept and leaves the price-book picker nowhere to live).
- **No global state library.** Per-screen hooks with `useReducer` where event folding needs it; the Supabase client owns the session. Nothing in the screen inventory shares state across routes except what the DB already mediates.

**Capture session**

- **Walk-and-talk: one continuous audio recording runs while the user snaps photos.** Full-screen viewfinder, pinned REC indicator with elapsed timer, photo thumbnails accumulate in a strip above the shutter, "Finish & Review" ends the session. One session produces one audio file, matching what the pipeline transcribes. Alternatives considered: sequential photos-then-narrate (two screens, less fluid demo), fully decoupled multi-clip capture (pipeline would need multi-clip transcription it doesn't have).
- **Recording auto-starts when the session starts.** A forgotten record button ruins a job-site session. Soft limits: 10 photos, 3 minutes of audio with a visible countdown past 2:30.
- **Pre-permission gate screen requests camera + mic together**, explaining why before the OS prompts fire. Denial renders a settings-link state, never a half-working camera. App backgrounding pauses the recording and shows a resume banner. Leaving mid-session asks "Discard capture?" and a discard deletes any already-uploaded media. Alternative considered: bare OS prompts on mount (denial leaves a black viewfinder; back-swipe silently orphans uploaded media).
- **Eager upload: each photo starts uploading the moment it is captured; audio uploads when recording stops.** Per-thumbnail upload state (spinner / check / retry badge); Generate stays disabled until every upload succeeds or the user removes failed items. By commit time most bytes are already up, so Generate is near-instant. Alternative considered: batch upload on Generate (single progress phase exactly when the user expects the pipeline to start; one flaky photo blocks everything at the worst moment).
- **Libraries: expo-camera + expo-audio** (expo-av is deprecated; neither is installed yet and both must be added).

**Generate transition and the waiting state**

- **Tapping Generate fires POST /generate and navigates immediately to `quote/[quoteId]`, replacing capture in the stack.** The review screen owns the entire generation experience from an empty canvas — which is also what the demo video frames. Alternative considered: waiting on the capture screen until the first event (splits the show across two screens, complicates back-navigation).
- **The pre-first-item wait (~15–35s of transcribe + vision) renders as a stage ticker driven by realtime `agent_traces` inserts.** As each node's trace row lands, the checklist ticks (Transcribing ✓ / Analyzing photos ✓ / Drafting…). Honest by construction — the same rows the trace screen shows. Requires one migration adding `agent_traces` (plus `quote_events`, `quote_line_items`, `quotes`) to the `supabase_realtime` publication; owner-scoped SELECT policies already exist under the RLS-everywhere rule. Alternatives considered: an indeterminate shimmer (30 dead seconds in the demo, proves nothing is happening), new node_started/node_completed event types (touches the proven backend pipeline in a mobile-only milestone).

**Live assembly motion (Reanimated)**

- **Line-item entry is a two-beat choreography:** the row enters with FadeInDown plus a slight spring scale and settles; its photo thumbnail scales in from zero inside the row ~150ms later; the running total animates as a rolling number to the new sum. The delayed thumbnail beat reads as "drafted, then evidence attached" — it sells the citation story. Layout animation handles list shifting. Alternatives considered: thumbnail flying from a persistent photo strip (shared-element animation across a scrolling list is the fragile kind of Reanimated work, and the strip permanently costs screen height), plain fade (undersells the demo centerpiece).
- **Retry retraction: dim in place, replace on arrival.** On `retry_started`, all drafted rows desaturate to ~60% opacity with a dimmed struck total, a "Revising draft — attempt 2" banner appears, and corrected items stream into a fresh section above; the dimmed group animates out when `generation_completed` lands. The retracted draft stays visible for the whole revision — the honest-retraction story never leaves the screen. Alternatives considered: sweeping items off-screen on retry (10–20 empty seconds, loses the mostly-good draft v1.2 says to keep visible), morphing old rows into corrected ones (drafts aren't keyed across retries; matching is a heuristic that will misfire on camera).
- **Catch-up rule: subscribe first, then fetch history, merge by event id, fold everything through one reducer.** Events recovered from history render instantly with no entry animation; only events arriving on the live channel animate. This closes the subscribe/insert race, makes reopening a finished quote just show the quote, and keeps the no-staged-animation rule intact — replayed history is never dressed up as live. Alternatives considered: fast-forward replay at 4x (animation over already-persisted data — exactly the staged-replay line), snapshot-plus-newer-events (needs a snapshot-to-event-id watermark the schema doesn't have).

**Review, editing, and send**

- **Editing is a bottom-sheet editor: tap a row to edit description, quantity, unit, and unit price; unpriced lines require a price before Send.** Swipe-to-delete on rows. Saves write directly to Supabase under RLS and the total recomputes. The sheet is a Reanimated-animated modal built in-repo — no @gorhom/bottom-sheet dependency, whose Reanimated 4 compatibility is unproven. Remote edits arriving via `useLineItemSync` flash a brief highlight on the changed row (the two-device demo shot). Alternatives considered: true inline fields (crowded rows, shrunken tap targets, mid-list keyboard avoidance inside a Reanimated list), full CRUD with add-line (a hand-added line has no photo citation — it either violates the min-1-citation invariant or needs a citation-picker; the pipeline stays the only line-item author, which keeps every line cited by construction).
- **Failed state is an inline banner, not a takeover.** Red banner at top ("Couldn't finalize this quote") with the Regenerate action; rows named in the `generation_failed` errors payload get a red edge and their specific validation message; clean rows stay normal and editable. Regenerate POSTs /generate again and the screen drops back into the standard stage-ticker → streaming flow. Alternative considered: full-screen failure takeover (hides the mostly-good draft and undersells self-correction).
- **Send opens the native share sheet.** The Send button is disabled while generating, failed, or any line is unpriced. On send: status flips to `sent`, the OS share sheet opens with the `q/[shareToken]` URL (RN Share API, no new dependency), editing locks to read-only, the header shows a Sent badge, and a Copy-link action remains. When the `quote_accepted` event lands, an Accepted banner overlays. Alternatives considered: an in-app link screen with QR (replicates what the OS sheet does), leaving edits open post-send (the client could accept a quote still mutating under them).

**Trace viewer**

- **Static fetch, vertical timeline of expandable node cards.** One `agent_traces` query on open, ordered by `created_at`: node name, duration badge, token badges on LLM nodes; tap expands pretty-printed input/output JSON in a scrollable monospace block. Retry runs render as a second attempt group behind a divider. Pull-to-refresh covers mid-run peeking; no realtime subscription here. Alternatives considered: a live-updating timeline (a second realtime consumer for a screen nobody opens mid-run), a raw JSON dump (this screen is a portfolio showpiece).

**Auth**

- **Passwordless email OTP, not a deep-linked magic link.** `signInWithOtp` emails a 6-digit code; the user types it into the app and `verifyOtp` establishes the session. Identical flow on an Android device, the iOS simulator, and EAS builds; no scheme/redirect configuration; recordable on a simulator with no mail client. Requires the Supabase email template to include the token, and the Supabase client gains AsyncStorage-backed session persistence (`@react-native-async-storage/async-storage`, new dependency). Alternatives considered: a true `quotelens://` deep-link magic link (per-environment redirect config, expo-linking auth handling, and awkward to complete on the exact machine the demo records on), link-plus-code fallback (two auth completion paths to build and test in a v1).

**Styling and theming**

- **Plain RN StyleSheet with a `src/lib/theme.ts` token module** (colors seeded from the existing brand blues `#208AEF` / `#E6F4FE`, spacing, radii, type scale). Identical pixels on both platforms — success criterion #1 stays mechanical. The scaffold's `@expo/ui` and `expo-glass-effect` are not used by screens: the former renders genuinely divergent SwiftUI/Jetpack UI and the latter is iOS-only. Icons via `@expo/vector-icons` (expo-symbols is iOS-only). Alternatives considered: NativeWind (a babel/metro plugin plus a Tailwind-v4 compatibility story added to a working strict-TS scaffold mid-project), leaning into @expo/ui (defensible only by amending success criterion #1).
- **Light-only in v1.** Single palette, `userInterfaceStyle` locked to `"light"`. One look across the demo video, Play screenshots, and both platforms; every UI state (dimmed retraction, invalid rows, banners) QAs once. Dark mode is named in README as future work. Alternative considered: dual palettes off `useColorScheme()` (cheap-ish with tokens, but doubles the QA surface in an all-UI milestone while store assets still show one mode).

### Data flow, auth, and access

- **Media uploads go direct from the phone to Supabase Storage.** The capture screen uploads photos and audio to the private bucket using the user's Supabase session, under RLS-scoped paths. POST /captures registers capture metadata rows; POST /generate takes storage paths and job ID. The backend reads media via service role and signed URLs. No large files transit FastAPI, uploads parallelize, and the free-tier backend stays light. Alternative considered: multipart through the API (one trust boundary, but doubles bandwidth through the weakest link and risks timeouts on large HEIC/audio bodies).
- **FastAPI verifies the Supabase JWT and acts via service role.** Mobile sends its Supabase access token in the Authorization header; a FastAPI dependency verifies the signature locally and extracts user_id; all backend DB access uses the service-role key with every query explicitly scoped to the verified user_id. RLS still guards all direct-from-device access. Alternative considered: passing the user JWT through to supabase-py so RLS applies to backend queries (no scoping bugs possible, but pipeline writes to traces and events exceed user policies, forcing a mixed-mode client anyway).
- **Supabase for auth, Postgres, Storage, Realtime.** Passwordless email auth only, completed via OTP code (v1.3; see Mobile UI/UX — Auth). RLS on every table. Photos and audio in a private bucket behind signed URLs. The Realtime channel powers both live assembly and the two-device sync demo shot.
- **Share link is an unguessable token, not auth.** The client quote page is public by design, scoped to one quote via a random share token. Accept writes a quote_events row. No client accounts in v1.
- **Fire-and-forget generation.** The mobile app subscribes to the Realtime channel after triggering /generate; live assembly makes polling unnecessary. No background job queue in v1; the upgrade path is documented in README limitations.

### Repo and process

- **Play listing copy follows brand voice rules.** No em-dashes, no slop phrases, no fabricated ratings or user counts, "portfolio project by SheryLabs" stated in the full description. A privacy policy page is a Play requirement and ships as a static page on the web app.
- **Monorepo, pnpm workspaces for mobile + web, uv for backend.** One repo, one commit history, one verify.sh.
- **verify.sh gates on: backend pytest, mobile tsc --noEmit, mobile eslint.** Playwright E2E on the web quote page only. No mobile E2E framework in v1, cost exceeds catch-rate at this scale.
- **Mobile UI/UX is specified before it is built, via the `/spec` interview.** Completed 2026-07-07: the interview ran at the start of the mobile-screens phase and its settled decisions are the **Mobile UI/UX** section above (this v1.3 amendment). Implementation proceeds against that section; any UI/UX question it does not answer gets resolved by a follow-up amendment, not an in-code improvisation.

## Out of scope

- Apple App Store distribution. iOS is simulator-demo only, stated in README and all public copy.
- Payment processing of any kind. Accept records agreement only. Stripe deposit flow is a documented integration path, never demoed as working.
- Offline-first sync. Capture requires connectivity. A capture queue for flaky connections is future work, named in README.
- Price book learning or historical-quote suggestions.
- Push notifications, deep links, in-app updates.
- Client accounts, multi-user teams, roles and permissions.
- PDF export of quotes. The web quote page is the deliverable format.
- Multi-language narration. English only in v1.
- Dark mode. Light-only palette in v1 (v1.3); named as future work in README.
- Manual line-item creation in the app. The pipeline is the only line-item author, preserving the citation invariant; edit and delete only (v1.3).
- Pause/resume narration. One continuous recording per capture session; multi-clip audio would require pipeline changes (v1.3).
- Play Store growth work: ASO, paid installs, review solicitation. The listing exists as proof, not as an acquisition channel.
- Any claim of paying users or client traction. Portfolio artifact, published on Play, source public. That is the claim, in full.

## Verification

The end-to-end check that must pass before this project is called done:

1. `cd backend && pytest -q` green, including: schema rejects a line item with empty photo_citations, validate rejects a citation naming a photo ID absent from the observation set, retry edge fires on a seeded invalid draft and succeeds on second pass, retry cap halts at 2 and surfaces a `failed` quote with the draft preserved, regenerate reuses cached transcript and observations without re-running transcribe or analyze_photos, pipeline emits one `line_item_drafted` event per line item in order plus `retry_started` on the forced-retry path, and the Pydantic quote schema regenerates byte-identical to `schema/quote.schema.json`.
2. `cd mobile && pnpm tsc --noEmit && pnpm lint` clean. Schema mirror test asserts the Zod schema matches `schema/quote.schema.json` field-for-field.
3. Manual E2E on both platforms, recorded as the demo asset: launch on a physical Android device and an iOS simulator, sign in via emailed one-time code, create a painting job, capture 3 photos plus a 45-second narration of a water-damaged bedroom, generate, watch line items assemble live with photo thumbnails attaching, receive a quote where every line cites a photo and at least one line shows the inferred flag with a vision-estimated quantity, edit a quantity on device A and watch it update on device B within 2 seconds, send, open the share link in a desktop browser, accept, confirm the quote_events row and the status change on both devices.
4. `pnpm playwright test` green on the web quote page: renders from share token, Accept persists, invalid token 404s.
5. Agent trace screen shows all seven nodes for the demo quote with non-zero durations, token counts on the LLM nodes, and the quote_events timeline aligns with the live assembly the video captured, including the seeded retry retraction.
6. Production AAB built via EAS, submitted to Google Play, and the listing is live and installable against the deployed free-tier backend. Store listing copy passes the brand voice rules, links the public repo, and discloses the demo backend.
7. The 90-second painter demo video is recorded against the local backend, following the story arc: walkthrough capture, live assembly with one visible retry retraction, cross-device edit, client accept.
8. README limitations section explicitly names: fire-and-forget generation, no payments, no offline, seeded price books, demo-scale transcription on the deployed tier, free-tier backend cold starts, iOS simulator-only. Each with its upgrade path in one sentence.

verify.sh wires checks 1 and 2 into the Stop hook so build sessions self-gate. Checks 3 through 8 are the human acceptance pass; the repo flips public after check 3, the Play submission (check 6) starts immediately after, and the LinkedIn cycle waits for checks 6 and 7.
