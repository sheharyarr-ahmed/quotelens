# QuoteLens · SPEC.md

Cross-platform (iOS + Android) AI quoting app for trades and field-service operators. Walk the job site, capture photos and a spoken narration, and an agent pipeline produces an itemized, evidence-cited estimate the operator reviews and sends before leaving the driveway. Portfolio project. Closes the React Native gap, ships as a portfolio package — a screenshot walkthrough, a public GitHub repo, and a live web quote sample — and reuses the mandatory-citation and self-correcting state machine patterns already proven in the portfolio.

v1.5 of this spec. Changes from v1.4: the demo artifact is re-scoped from a **recorded video on a physical iPhone** to a **screenshot walkthrough captured on the iOS simulator**. The v1.4 plan was attempted live on 2026-07-15 and 2026-07-21 and failed on environment, not on product: the available Wi-Fi client-isolates devices, so the iPhone could not reach the Mac's FastAPI over the LAN at all. Rather than keep an acceptance check hostage to a network, the deliverable becomes stills. Consequences: the backend now binds localhost (no LAN exposure, no hotspot), the demo runs entirely on the simulator, and because the simulator has no camera and capture is expo-camera-only with no library fallback, the capture session's media is seeded from the committed fixtures via `backend/scripts/seed_live_demo.py` and the **real pipeline then runs end to end** over it. What this honestly does *not* prove visually: the capture UI itself (viewfinder, shutter, thumbnail strip) and the two-device sync shot; both remain covered by tests and `mobile/scripts/live-verify.ts` rather than by a picture, and the README says so. Dropped with the video: `docs/demo.gif`, the 90-second length constraint, the Mac-LAN networking requirement, and the physical-iPhone device requirement wherever they appeared. This is a deliverable/evidence re-scope; no product behavior changed.

Changes from v1.3.1: the milestone-3 `/spec` interview (2026-07-10) re-scoped the release. QuoteLens ships as a **portfolio package** — a recorded demo video, a polished public GitHub repo/README, and a live web quote sample hosted on Vercel — **not** as a published app-store listing. Dropped from scope: Google Play submission, the EAS production Android App Bundle, the $25 developer fee, the store listing assets, cloud backend hosting, the privacy-policy page (a store-only requirement), and OTA updates. The backend runs locally on the Mac LAN for the demo, which is recorded on a physical iPhone (where the camera works); only the Next.js quote page is hosted (Vercel, reading hosted Supabase directly, so it is live and clickable without a hosted backend). The email-OTP SMTP provider is settled as **Brevo** and was configured live on 2026-07-10 (`backend/scripts/configure_email_smtp.py`); email sign-in now delivers a typable 6-digit code. See the new **Milestone 3 — portfolio release** decision. This is a distribution/deliverable re-scope; no product behavior changed.

Changes from v1.3: live verification (2026-07-09) surfaced a hosted-Supabase platform constraint on the settled Auth decision — email templates and the 2-emails/hour built-in send cap are locked until a custom SMTP provider is configured, and the default email OTP length is 8 while the settled UI accepts 6. The Auth decision under Mobile UI/UX now records custom SMTP as a hard prerequisite for email sign-in; the provider choice is settled in the milestone-3 interview. No product behavior changed.

Changes from v1.2.1: the mobile UI/UX interview mandated by "Repo and process" ran on 2026-07-07 and its settled decisions are recorded in the new **Mobile UI/UX** section under Decisions. Structural consequences: navigation is jobs-first with no tab bar, auth completes via emailed one-time code instead of a deep-linked magic link, styling is a plain StyleSheet token module (light-only), the review screen's waiting state is driven by realtime `agent_traces` inserts (one small migration), and dark mode / manual line-item creation / pause-resume narration move to Out of scope.

Changes from v1.2: two tooling amendments — the mobile mirror test uses Zod 4's native `z.toJSONSchema()` (the `zod-to-json-schema` package named in v1.2 is unmaintained since Nov 2025), and the web app pins Next.js 16 LTS instead of 15 (Next 15 LTS reaches end of life Oct 2026, inside this project's public lifetime).

Changes from v1.1: scoping interview resolved eleven open implementation questions. The pipeline gains a dedicated analyze_photos vision node (seven nodes total), retry behavior in the live-assembly UI is specified as visible retraction, media uploads go direct to Supabase Storage, backend hosting and whisper sizing are pinned for the free-tier deploy, and price book matching, schema-mirror mechanics, realtime transport, API auth, failure state, and the pricing model are all decided below.

---

## Goal

A worker opens the app on any phone, photographs the work area, records a voice walkthrough, and taps Generate. The pipeline transcribes the audio, runs Claude vision on the photos, cross-references a seeded price book, and returns a structured quote: line items with quantity, unit price, total, at least one photo citation per line, and a confidence flag on any line the model inferred rather than heard. Line items stream into the review screen one by one as the pipeline emits them, each animating in with its photo thumbnail attaching. The worker edits inline, taps Send, and the client receives a web quote link with an Accept button that records acceptance.

Success is demonstrated end-to-end when:

1. The same codebase runs on the iOS simulator with no platform-forked screens and no iOS-only UI primitives in screens; iOS-device and Android support follow from the same Expo codebase and are named in the README as untested on device, not separately demoed.
2. The deliverable is a portfolio package: a screenshot walkthrough embedded in the README, a public GitHub repo with a portfolio-grade README, and a live web quote sample hosted on Vercel. No app-store distribution; the scope is disclosed honestly in the README.
3. A real pipeline run for a painting job over real capture media (3+ photos, 30 to 60 seconds of speech) produces a valid quote in under 90 seconds. This bound is a pipeline latency budget and is unrelated to the length of any demo artifact.
4. Every line item carries at least one photo citation, and every citation refers to a photo the vision node actually analyzed. A quote with an uncited line item fails schema validation and never reaches the UI.
5. Quote generation renders as live assembly: line items appear progressively with photo thumbnails attaching, driven by real pipeline events, not a fake staged animation over a finished result. If the retry edge fires, the UI shows it honestly: drafted items sweep into a dimmed revising state and the corrected items stream in fresh.
6. Editing a quote on one device updates the open quote screen on a second device via Supabase Realtime within 2 seconds, proven by `mobile/scripts/live-verify.ts` against live services rather than by a demo still.
7. The client quote page renders from a signed share link without authentication and the Accept action persists.
8. The agent trace screen shows every pipeline node with input, output, duration, and token count.
9. The screenshot walkthrough exists: one painter, one water-damaged bedroom, seeded capture through to accepted quote, captured on the iOS simulator with the client Accept shown in a desktop browser.

Non-goals for success: app-store distribution (Apple App Store and Google Play), payment collection, offline-first sync, price learning. See Out of scope.

## Files

```
quotelens/
├── SPEC.md
├── README.md                          # architecture, honest limitations, live web sample link,
│                                      #   embedded screenshot walkthrough
├── docs/
│   ├── SCREENSHOT_RUNBOOK.md          # how the walkthrough is captured and re-captured
│   └── screenshots/                   # committed PNGs the README embeds (simulator, 9:41 status bar)
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
│   └── app.json                       # app identity: package id, adaptive icon, permission strings
│                                      #   (no eas.json / AAB — portfolio package, not a store build, v1.4)
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
├── store/                             # descoped in v1.4 (no store listing). Screenshots live in
│                                      #   docs/screenshots (v1.5); listing.md, feature-graphic, and
│                                      #   the privacy-policy page are dropped with Google Play
└── supabase/
    └── migrations/                    # tables: profiles, price_books, price_book_items,
                                       #   jobs, captures, quotes, quote_line_items,
                                       #   quote_events, agent_traces. RLS on every table.
                                       #   v1.3 adds: quote_events, quote_line_items, quotes,
                                       #   agent_traces in the supabase_realtime publication.
```

## Decisions

### Platform and distribution

- **React Native with Expo, not bare RN.** Expo Router, expo-camera, expo-audio cover the full capture surface. The same codebase targets iOS and Android with no platform-forked screens; the demo runs on the iOS simulator (v1.5), with capture media seeded from fixtures because the simulator has no camera. Ejecting is a documented escape hatch, not a v1 need.
- **Ships as a portfolio package, not an app-store listing (re-scoped in the v1.4 milestone-3 interview).** The deliverable is a screenshot walkthrough, a public GitHub repo with a portfolio-grade README, and a live web quote sample on Vercel — the artifacts that carry a solo founder's work onto LinkedIn, a portfolio catalog, and vetting calls. A store listing is dropped: Google Play's $25 fee, identity verification, review lead time, and closed-testing plumbing are real cost for a portfolio piece whose audience reaches it through a link and a video, not a store search; Apple's App Store ($99/yr) fails the same test. Neither is pursued, and the README states the scope plainly. Alternatives considered (carried from v1.1–v1.3): a live Google Play closed/public listing (moves "repo and video" to "installable product," but the review overhead and developer accounts buy little for an artifact nobody installs from a store), a tunneled public backend behind a symbolic listing (a listing without substance). Rejected in favor of demo + repo + one hosted web sample.
- **Demo scope is the painting trade.** The screenshot walkthrough, the seeded default price book, and the README hero all follow one painter through one water-damaged bedroom. One story demos stronger than a generic multi-trade pitch. HVAC and landscaping price book templates still ship as seed data to prove the pattern generalizes, but no demo asset features them.
- **Backend runs locally on the Mac for the demo; only the web quote page is hosted (Vercel).** No cloud backend. The demo is captured on the iOS simulator, which reaches FastAPI on `localhost` (`EXPO_PUBLIC_API_URL=http://localhost:8000`), so transcription and the pipeline run at full quality with zero hosting cost or cold starts. The v1.4 LAN arrangement (a physical iPhone reaching the Mac by IP) is dropped: the available Wi-Fi client-isolates devices, which no amount of app configuration can work around. The Next.js quote page deploys to Vercel because it renders server-side straight from hosted Supabase by share token — it needs no backend, so it stays a live, clickable portfolio link, and `EXPO_PUBLIC_WEB_URL` points the app's share links at it. `SUPABASE_SERVICE_ROLE_KEY` is a server-only Vercel env var, never `NEXT_PUBLIC_`. Alternatives considered: also hosting FastAPI (Railway/Render give faster-whisper real RAM, but a locally captured walkthrough needs no reachable backend and it adds spend), everything on localhost incl. the web page (no clickable sample for the portfolio). CORS is not required — the RN app calls FastAPI directly (React Native does not enforce CORS) and the web Accept uses same-origin Next routes; add CORS only if a browser ever calls FastAPI directly.

### Pipeline

- **Pipeline is an explicit state machine with one bounded retry edge. Seven nodes: transcribe, analyze_photos, parse_walkthrough, match_pricebook, draft_line_items, validate, compile_quote.** transcribe and analyze_photos fan out in parallel from the entry point and join at parse_walkthrough. Validate failures loop back to draft_line_items with retryCount < 2 hardcoded. Implemented in LangGraph Python, putting the Python variant in the portfolio alongside the existing JS one.
- **analyze_photos is a dedicated vision node, not vision folded into drafting.** It runs Claude Sonnet vision once per photo (parallel calls), producing structured observations tagged with photo IDs: surfaces, damage, rooms, approximate dimensions. draft_line_items receives observations plus the parsed transcript and may only cite photo IDs present in the observation set; validate checks that every citation refers to an observed photo. This makes citations mechanically checkable instead of self-reported, fixes vision cost per capture (retries do not re-pay vision), and gives the trace screen a clean seeing-vs-drafting separation. Alternative considered: one multimodal draft call (fewer hops, but citations become self-reported by the same call that drafts, and every retry re-pays full vision cost).
- **Claude Haiku for parse_walkthrough, match_pricebook, and draft_line_items; Sonnet for analyze_photos.** Cheap path for text reasoning, stronger model where image understanding earns it. Every node writes to agent_traces.
- **match_pricebook is a single Haiku call with the full active price book in context.** Seeded books are small (roughly 40 to 80 items), so the whole book plus the parsed tasks fit one cheap call. Output is schema-constrained to either an existing price_book_item_id or null per task; null renders as `unpriced`. The model can only pick IDs that exist, so the no-invented-prices rule stays mechanical. Alternatives considered: embeddings plus a similarity threshold (adds an embedding pipeline and threshold tuning that demo scale never earns), fuzzy keyword match with LLM fallback (two matching code paths to test).
- **Transcription via faster-whisper in-process, model size set by WHISPER_MODEL env var, int8 compute.** Local dev and the screenshot walkthrough use `small` (best accuracy where it matters); the deployed free tier uses `base` (roughly 300MB, fits 512MB instances). Zero API spend, one code path. README names managed transcription as the production path and marks deployed transcription as demo-grade. Alternatives considered: `small` everywhere (couples the project to whichever host still gives 2GB free), `tiny` deployed (noticeably worse public experience).
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

- **Tapping Generate fires POST /generate and navigates immediately to `quote/[quoteId]`, replacing capture in the stack.** The review screen owns the entire generation experience from an empty canvas — which is also what the screenshot walkthrough frames. Alternative considered: waiting on the capture screen until the first event (splits the show across two screens, complicates back-navigation).
- **The pre-first-item wait (~15–35s of transcribe + vision) renders as a stage ticker driven by realtime `agent_traces` inserts.** As each node's trace row lands, the checklist ticks (Transcribing ✓ / Analyzing photos ✓ / Drafting…). Honest by construction — the same rows the trace screen shows. Requires one migration adding `agent_traces` (plus `quote_events`, `quote_line_items`, `quotes`) to the `supabase_realtime` publication; owner-scoped SELECT policies already exist under the RLS-everywhere rule. Alternatives considered: an indeterminate shimmer (30 dead seconds in the demo, proves nothing is happening), new node_started/node_completed event types (touches the proven backend pipeline in a mobile-only milestone).

**Live assembly motion (Reanimated)**

- **Line-item entry is a two-beat choreography:** the row enters with FadeInDown plus a slight spring scale and settles; its photo thumbnail scales in from zero inside the row ~150ms later; the running total animates as a rolling number to the new sum. The delayed thumbnail beat reads as "drafted, then evidence attached" — it sells the citation story. Layout animation handles list shifting. Alternatives considered: thumbnail flying from a persistent photo strip (shared-element animation across a scrolling list is the fragile kind of Reanimated work, and the strip permanently costs screen height), plain fade (undersells the demo centerpiece).
- **Retry retraction: dim in place, replace on arrival.** On `retry_started`, all drafted rows desaturate to ~60% opacity with a dimmed struck total, a "Revising draft — attempt 2" banner appears, and corrected items stream into a fresh section above; the dimmed group animates out when `generation_completed` lands. The retracted draft stays visible for the whole revision — the honest-retraction story never leaves the screen. Alternatives considered: sweeping items off-screen on retry (10–20 empty seconds, loses the mostly-good draft v1.2 says to keep visible), morphing old rows into corrected ones (drafts aren't keyed across retries; matching is a heuristic that will misfire mid-run).
- **Catch-up rule: subscribe first, then fetch history, merge by event id, fold everything through one reducer.** Events recovered from history render instantly with no entry animation; only events arriving on the live channel animate. This closes the subscribe/insert race, makes reopening a finished quote just show the quote, and keeps the no-staged-animation rule intact — replayed history is never dressed up as live. Alternatives considered: fast-forward replay at 4x (animation over already-persisted data — exactly the staged-replay line), snapshot-plus-newer-events (needs a snapshot-to-event-id watermark the schema doesn't have).

**Review, editing, and send**

- **Editing is a bottom-sheet editor: tap a row to edit description, quantity, unit, and unit price; unpriced lines require a price before Send.** Swipe-to-delete on rows. Saves write directly to Supabase under RLS and the total recomputes. The sheet is a Reanimated-animated modal built in-repo — no @gorhom/bottom-sheet dependency, whose Reanimated 4 compatibility is unproven. Remote edits arriving via `useLineItemSync` flash a brief highlight on the changed row. Alternatives considered: true inline fields (crowded rows, shrunken tap targets, mid-list keyboard avoidance inside a Reanimated list), full CRUD with add-line (a hand-added line has no photo citation — it either violates the min-1-citation invariant or needs a citation-picker; the pipeline stays the only line-item author, which keeps every line cited by construction).
- **Failed state is an inline banner, not a takeover.** Red banner at top ("Couldn't finalize this quote") with the Regenerate action; rows named in the `generation_failed` errors payload get a red edge and their specific validation message; clean rows stay normal and editable. Regenerate POSTs /generate again and the screen drops back into the standard stage-ticker → streaming flow. Alternative considered: full-screen failure takeover (hides the mostly-good draft and undersells self-correction).
- **Send opens the native share sheet.** The Send button is disabled while generating, failed, or any line is unpriced. On send: status flips to `sent`, the OS share sheet opens with the `q/[shareToken]` URL (RN Share API, no new dependency), editing locks to read-only, the header shows a Sent badge, and a Copy-link action remains. When the `quote_accepted` event lands, an Accepted banner overlays. Alternatives considered: an in-app link screen with QR (replicates what the OS sheet does), leaving edits open post-send (the client could accept a quote still mutating under them).

**Trace viewer**

- **Static fetch, vertical timeline of expandable node cards.** One `agent_traces` query on open, ordered by `created_at`: node name, duration badge, token badges on LLM nodes; tap expands pretty-printed input/output JSON in a scrollable monospace block. Retry runs render as a second attempt group behind a divider. Pull-to-refresh covers mid-run peeking; no realtime subscription here. Alternatives considered: a live-updating timeline (a second realtime consumer for a screen nobody opens mid-run), a raw JSON dump (this screen is a portfolio showpiece).

**Auth**

- **Passwordless email OTP, not a deep-linked magic link.** `signInWithOtp` emails a 6-digit code; the user types it into the app and `verifyOtp` establishes the session. Identical flow on an Android device, the iOS simulator, and EAS builds; no scheme/redirect configuration; recordable on a simulator with no mail client. Requires the Supabase email template to include the token, and the Supabase client gains AsyncStorage-backed session persistence (`@react-native-async-storage/async-storage`, new dependency). Alternatives considered: a true `quotelens://` deep-link magic link (per-environment redirect config, expo-linking auth handling, and awkward to complete on the exact machine the demo records on), link-plus-code fallback (two auth completion paths to build and test in a v1). Platform constraint discovered live (v1.3.1): hosted Supabase only allows editing email templates — and raising the 2-emails/hour built-in send cap — once a custom SMTP provider is configured, and defaults the email OTP length to 8; email sign-in therefore additionally requires custom SMTP, code-only `{{ .Token }}` templates in both Confirm signup and Magic Link, and Email OTP Length set to 6 (provider choice: milestone-3 interview). Until SMTP is configured, sign-in codes are minted via `auth.admin.generateLink` (`backend/scripts/mint_login_code.py`). **Settled and configured in the v1.4 milestone-3 interview (2026-07-10):** the SMTP provider is **Brevo** (free 300/day, no domain — the owner's gmail verified as sender). `backend/scripts/configure_email_smtp.py` applies the custom-SMTP settings, code-only `{{ .Token }}` templates for both Magic Link and Confirm signup, and OTP length 6 to the hosted project via the Management API (idempotent, reads `BREVO_*` from `.env`). Verified end-to-end: a real 6-digit code is emailed and signs in. Brevo's free tier rewrites the From to `@<id>.brevosend.com`; a branded sending domain is future work.

**Styling and theming**

- **Plain RN StyleSheet with a `src/lib/theme.ts` token module** (colors seeded from the existing brand blues `#208AEF` / `#E6F4FE`, spacing, radii, type scale). Identical pixels on both platforms — success criterion #1 stays mechanical. The scaffold's `@expo/ui` and `expo-glass-effect` are not used by screens: the former renders genuinely divergent SwiftUI/Jetpack UI and the latter is iOS-only. Icons via `@expo/vector-icons` (expo-symbols is iOS-only). Alternatives considered: NativeWind (a babel/metro plugin plus a Tailwind-v4 compatibility story added to a working strict-TS scaffold mid-project), leaning into @expo/ui (defensible only by amending success criterion #1).
- **Light-only in v1.** Single palette, `userInterfaceStyle` locked to `"light"`. One look across the README screenshots and both platforms; every UI state (dimmed retraction, invalid rows, banners) QAs once. Dark mode is named in README as future work. Alternative considered: dual palettes off `useColorScheme()` (cheap-ish with tokens, but doubles the QA surface in an all-UI milestone while store assets still show one mode).

### Data flow, auth, and access

- **Media uploads go direct from the phone to Supabase Storage.** The capture screen uploads photos and audio to the private bucket using the user's Supabase session, under RLS-scoped paths. POST /captures registers capture metadata rows; POST /generate takes storage paths and job ID. The backend reads media via service role and signed URLs. No large files transit FastAPI, uploads parallelize, and the backend stays light. Alternative considered: multipart through the API (one trust boundary, but doubles bandwidth through the weakest link and risks timeouts on large HEIC/audio bodies).
- **FastAPI verifies the Supabase JWT and acts via service role.** Mobile sends its Supabase access token in the Authorization header; a FastAPI dependency verifies the signature locally and extracts user_id; all backend DB access uses the service-role key with every query explicitly scoped to the verified user_id. RLS still guards all direct-from-device access. Alternative considered: passing the user JWT through to supabase-py so RLS applies to backend queries (no scoping bugs possible, but pipeline writes to traces and events exceed user policies, forcing a mixed-mode client anyway).
- **Supabase for auth, Postgres, Storage, Realtime.** Passwordless email auth only, completed via OTP code (v1.3; see Mobile UI/UX — Auth). RLS on every table. Photos and audio in a private bucket behind signed URLs. The Realtime channel powers both live assembly and cross-device edit sync.
- **Share link is an unguessable token, not auth.** The client quote page is public by design, scoped to one quote via a random share token. Accept writes a quote_events row. No client accounts in v1.
- **Fire-and-forget generation.** The mobile app subscribes to the Realtime channel after triggering /generate; live assembly makes polling unnecessary. No background job queue in v1; the upgrade path is documented in README limitations.

### Repo and process

- **README and LinkedIn/portfolio copy follow brand voice rules.** No em-dashes, no slop phrases, no fabricated ratings or user counts; "portfolio project by SheryLabs" stated plainly, source public on GitHub. (v1.4: the Play listing copy and the privacy-policy page are dropped with store distribution — the privacy page was a store-only requirement.)
- **Monorepo, pnpm workspaces for mobile + web, uv for backend.** One repo, one commit history, one verify.sh.
- **verify.sh gates on: backend pytest, mobile tsc --noEmit, mobile eslint.** Playwright E2E on the web quote page only. No mobile E2E framework in v1, cost exceeds catch-rate at this scale.
- **Mobile UI/UX is specified before it is built, via the `/spec` interview.** Completed 2026-07-07: the interview ran at the start of the mobile-screens phase and its settled decisions are the **Mobile UI/UX** section above (this v1.3 amendment). Implementation proceeds against that section; any UI/UX question it does not answer gets resolved by a follow-up amendment, not an in-code improvisation.

## Out of scope

- All app-store distribution — Apple App Store **and Google Play** (dropped v1.4). The app is demoed on the iOS simulator (v1.5); an iPhone build and Android both run the same Expo code but neither is separately shipped or demoed. Stated in the README and all public copy.
- EAS production build / Android App Bundle, any store submission, and OTA updates (expo-updates / EAS Update). No `eas.json`, no `owner`/projectId setup in v1 (dropped v1.4).
- Cloud backend hosting. The FastAPI backend runs locally on the Mac (localhost) for the demo; only the Next.js quote page is hosted (Vercel), reading hosted Supabase directly (dropped v1.4).
- A recorded demo video, and any physical-device demo. The walkthrough is stills captured on the iOS simulator; the capture UI and the two-device sync shot are proven by tests and `mobile/scripts/live-verify.ts`, not by images, and the README says so (dropped v1.5).
- A privacy-policy page. It was a Google Play requirement only; with no store, it is dropped (v1.4).
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
- Any growth or acquisition work: ASO, paid installs, review solicitation, marketing funnels. The demo and repo exist as proof of capability, not as an acquisition channel.
- Any claim of paying users or client traction. Portfolio artifact — source public on GitHub, demonstrated in screenshots of a real run, one hosted web sample. That is the claim, in full.

## Verification

The end-to-end check that must pass before this project is called done:

1. `cd backend && pytest -q` green, including: schema rejects a line item with empty photo_citations, validate rejects a citation naming a photo ID absent from the observation set, retry edge fires on a seeded invalid draft and succeeds on second pass, retry cap halts at 2 and surfaces a `failed` quote with the draft preserved, regenerate reuses cached transcript and observations without re-running transcribe or analyze_photos, pipeline emits one `line_item_drafted` event per line item in order plus `retry_started` on the forced-retry path, and the Pydantic quote schema regenerates byte-identical to `schema/quote.schema.json`.
2. `cd mobile && pnpm tsc --noEmit && pnpm lint` clean. Schema mirror test asserts the Zod schema matches `schema/quote.schema.json` field-for-field.
3. Manual E2E on the iOS simulator, captured as the demo asset: sign in via the emailed 6-digit code, create a painting job, seed the capture media from the committed fixtures (`backend/scripts/seed_live_demo.py seed`, because the simulator has no camera), run the real pipeline (`... run <quote_id>`), watch line items assemble live with photo thumbnails attaching, receive a quote where every line cites a photo and at least one line shows the inferred flag with a vision-estimated quantity, price the unpriced line to unlock Send, send, open the share link in a desktop browser, accept, and confirm in the database that the quote status is `accepted` with exactly one `quote_accepted` event.
4. `pnpm playwright test` green on the web quote page: renders from share token, Accept persists, invalid token 404s.
5. Agent trace screen shows all seven nodes for the demo quote with non-zero durations, token counts on the LLM nodes, and a second attempt group from the seeded retry. The `quote_events` rows for that quote, queried directly, contain one `line_item_drafted` per line in emission order plus the `retry_started` row — so the assembly the screenshots show is provably the events the pipeline emitted, not a staged animation.
6. The Next.js quote page is deployed to Vercel and live: a public sample quote renders from its share token with no auth, the Accept action persists against hosted Supabase, and `SUPABASE_SERVICE_ROLE_KEY` is set server-only. `EXPO_PUBLIC_WEB_URL` points the app's share links at the deployed URL.
7. The painter screenshot walkthrough is captured on the iOS simulator against the localhost backend and committed to `docs/screenshots/`, covering the story arc in stills: the stage ticker mid-generation, live assembly partway through, the dimmed retry retraction with its "Revising draft" banner, the completed quote showing photo citations and one inferred flag, the agent trace, the public web quote page, and the Accepted banner back in the app.
8. The portfolio-grade README exists: architecture, the seven-node pipeline, the hard invariants, run instructions, the embedded screenshot walkthrough, and the live web sample link. Its limitations section explicitly names: fire-and-forget generation, no payments, no offline, seeded price books, backend runs locally (not hosted), Android supported by the same Expo code but demoed on iOS, and the demo captured on the simulator with fixture-seeded capture media so the capture UI itself is covered by tests rather than by a screenshot. Each with its upgrade path in one sentence.

verify.sh wires checks 1 and 2 into the Stop hook so build sessions self-gate. Checks 3 through 8 are the human acceptance pass: the repo flips public after check 3, the web sample (check 6) deploys alongside, and the LinkedIn/portfolio cycle waits for checks 6 and 7 — the live sample link and the screenshot walkthrough.
