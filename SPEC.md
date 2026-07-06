# QuoteLens · SPEC.md

Cross-platform (iOS + Android) AI quoting app for trades and field-service operators. Walk the job site, capture photos and a spoken narration, and an agent pipeline produces an itemized, evidence-cited estimate the operator reviews and sends before leaving the driveway. Portfolio project. Closes the React Native gap, ships as a published Google Play listing, and reuses the mandatory-citation and self-correcting state machine patterns already proven in the portfolio.

v1.1 of this spec. Changes from v1.0: Google Play publication added as a deliverable, demo scope narrowed to the painting trade, live quote assembly added as a first-class UI feature.

---

## Goal

A worker opens the app on any phone, photographs the work area, records a voice walkthrough, and taps Generate. The pipeline transcribes the audio, runs Claude vision on the photos, cross-references a seeded price book, and returns a structured quote: line items with quantity, unit price, total, at least one photo citation per line, and a confidence flag on any line the model inferred rather than heard. Line items stream into the review screen one by one as the pipeline emits them, each animating in with its photo thumbnail attaching. The worker edits inline, taps Send, and the client receives a web quote link with an Accept button that records acceptance.

Success is demonstrated end-to-end when:

1. The same codebase runs on an iOS simulator and a physical Android device with no platform-forked screens.
2. QuoteLens is live on Google Play as an installable public listing. iOS remains simulator-only, disclosed honestly in the README.
3. A real capture session for a painting job (3+ photos, 30 to 60 seconds of speech) produces a valid quote in under 90 seconds.
4. Every line item carries at least one photo citation. A quote with an uncited line item fails schema validation and never reaches the UI.
5. Quote generation renders as live assembly: line items appear progressively with photo thumbnails attaching, driven by real pipeline events, not a fake staged animation over a finished result.
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
├── .claude/                           # committed scaffold, same pattern as prior projects
│   └── verify.sh                      # backend pytest + mobile tsc + lint, gates the Stop hook
├── .githooks/
│   └── commit-msg                     # rejects AI-attribution strings
├── mobile/                            # React Native (Expo), TypeScript strict
│   ├── app/                           # expo-router screens
│   │   ├── (auth)/login.tsx           # magic-link auth
│   │   ├── (tabs)/index.tsx           # quotes list
│   │   ├── capture/[jobId].tsx        # camera + audio capture session
│   │   ├── quote/[quoteId].tsx        # review/edit screen, Realtime-subscribed, live assembly renderer
│   │   └── quote/[quoteId]/trace.tsx  # agent trace viewer
│   ├── src/
│   │   ├── api/                       # typed client for FastAPI endpoints
│   │   ├── components/                # QuoteLineItem, ConfidenceFlag, PhotoCitation,
│   │   │                              #   PriceBookEditor, LiveAssemblyList (Reanimated)
│   │   ├── hooks/                     # useCaptureSession, useRealtimeQuote, useQuoteAssembly
│   │   └── lib/                       # supabase client, zod schemas mirrored from backend
│   ├── __tests__/                     # schema mirror tests, hook tests
│   ├── app.json                       # Play Store identity: package id, versionCode, adaptive icon
│   └── eas.json                       # EAS build profiles incl. production AAB for Play submission
├── backend/                           # FastAPI, Python 3.11+
│   ├── app/
│   │   ├── main.py
│   │   ├── routes/                    # /upload, /generate, /quotes, /health
│   │   ├── pipeline/                  # the agent state machine
│   │   │   ├── graph.py               # node wiring + conditional retry edge
│   │   │   ├── nodes/                 # transcribe, parse_walkthrough, match_pricebook,
│   │   │   │                          #   draft_line_items, validate, compile_quote
│   │   │   ├── events.py              # per-line-item pipeline events feeding live assembly
│   │   │   └── schemas.py             # Pydantic models, citation constraint enforced here
│   │   ├── services/                  # transcription, claude client, storage, trace writer
│   │   └── db/                        # Supabase access layer
│   └── tests/                         # pipeline unit tests incl. forced-retry path
├── web/                               # Next.js 15 App Router, client quote page only
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
```

## Decisions

- **React Native with Expo, not bare RN.** Expo Router, expo-camera, expo-av cover the full capture surface. EAS free tier builds both platforms and produces the production Android App Bundle for Play submission. Ejecting is a documented escape hatch, not a v1 need.
- **Google Play publication is in scope; Apple App Store is not.** One-time $25 Play developer fee is the single approved cash spend on this project, justified because a live store listing moves the project from "repo and video" to "installable product" and answers the store-link question mobile clients ask. Apple's $99/year fails the same cost-benefit test at portfolio stage. iOS ships as simulator demo, disclosed plainly. Play review lead time (several days to two weeks for new developer accounts, closed-testing requirements may apply) is treated as a schedule item, submission happens as soon as the manual E2E passes, not after polish.
- **Demo scope is the painting trade.** The demo video, the seeded default price book, the store screenshots, and the README hero all follow one painter through one water-damaged bedroom. One story demos stronger than a generic multi-trade pitch. HVAC and landscaping price book templates still ship as seed data to prove the pattern generalizes, but no demo asset features them.
- **Live quote assembly is a product feature, not a demo trick.** The pipeline emits a per-line-item event as draft_line_items produces each entry. Events persist to quote_events and stream to the client over the existing Supabase Realtime channel. The review screen renders arrivals through a Reanimated list: item slides in, photo thumbnail attaches, running total ticks up. Hard rule: the animation is driven by real pipeline events. No staged fake over a finished quote, because the trace screen would expose the mismatch and the honesty of the pipeline is the selling point.
- **TypeScript strict on mobile and web, Pydantic v2 on backend, Zod mirrors of the quote schema on the client.** The quote schema is defined once in Pydantic, mirrored in Zod, and a test asserts the two stay in sync.
- **Mandatory photo citations as a schema constraint, not a prompt instruction.** `QuoteLineItem.photo_citations` must be non-empty or validation fails and the retry edge fires. This is the line defended in vetting calls.
- **Confidence flag is a first-class field.** Any line item derived from inference rather than explicit narration is marked `confidence: "inferred"` and rendered with a visible flag. The model declaring uncertainty is a feature.
- **Pipeline is an explicit state machine with one bounded retry edge.** Six nodes: transcribe, parse_walkthrough, match_pricebook, draft_line_items, validate, compile_quote. Validate failures loop back to draft_line_items with retryCount < 2 hardcoded. Implemented in LangGraph Python, putting the Python variant in the portfolio alongside the existing JS one.
- **Claude Haiku for parse_walkthrough and draft_line_items, Sonnet for vision.** Cheap path for text reasoning, stronger model where image understanding earns it. Every node writes to agent_traces.
- **Transcription via faster-whisper (small model) in-process on the backend.** Zero API spend, runs at dev and demo scale. Managed transcription API named in README as the production path, not implemented.
- **Supabase for auth, Postgres, Storage, Realtime.** Magic-link auth only. RLS on every table. Photos and audio in a private bucket behind signed URLs. The Realtime channel powers both live assembly and the two-device sync demo shot.
- **Seeded price books, no learning.** Painting is the default and demo book; HVAC and landscaping ship as alternates. The app never invents a price absent from the book. Unmatched work renders as `unpriced` for manual entry rather than a guessed number.
- **Share link is an unguessable token, not auth.** The client quote page is public by design, scoped to one quote via a random share token. Accept writes a quote_events row. No client accounts in v1.
- **Fire-and-forget generation.** The mobile app subscribes to the Realtime channel after triggering /generate; live assembly makes polling unnecessary. No background job queue in v1; the upgrade path is documented in README limitations.
- **Play listing copy follows brand voice rules.** No em-dashes, no slop phrases, no fabricated ratings or user counts, "portfolio project by SheryLabs" stated in the full description. A privacy policy page is a Play requirement and ships as a static page on the web app.
- **Monorepo, pnpm workspaces for mobile + web, uv for backend.** One repo, one commit history, one verify.sh.
- **verify.sh gates on: backend pytest, mobile tsc --noEmit, mobile eslint.** Playwright E2E on the web quote page only. No mobile E2E framework in v1, cost exceeds catch-rate at this scale.

## Out of scope

- Apple App Store distribution. iOS is simulator-demo only, stated in README and all public copy.
- Payment processing of any kind. Accept records agreement only. Stripe deposit flow is a documented integration path, never demoed as working.
- Offline-first sync. Capture requires connectivity. A capture queue for flaky connections is future work, named in README.
- Price book learning or historical-quote suggestions.
- Push notifications, deep links, in-app updates.
- Client accounts, multi-user teams, roles and permissions.
- PDF export of quotes. The web quote page is the deliverable format.
- Multi-language narration. English only in v1.
- Play Store growth work: ASO, paid installs, review solicitation. The listing exists as proof, not as an acquisition channel.
- Any claim of paying users or client traction. Portfolio artifact, published on Play, source public. That is the claim, in full.

## Verification

The end-to-end check that must pass before this project is called done:

1. `cd backend && pytest -q` green, including: schema rejects a line item with empty photo_citations, retry edge fires on a seeded invalid draft and succeeds on second pass, retry cap halts at 2 and surfaces a structured failure, pipeline emits one event per line item in order.
2. `cd mobile && pnpm tsc --noEmit && pnpm lint` clean. Schema mirror test asserts Zod and Pydantic quote schemas match field-for-field.
3. Manual E2E on both platforms, recorded as the demo asset: launch on a physical Android device and an iOS simulator, sign in via magic link, create a painting job, capture 3 photos plus a 45-second narration of a water-damaged bedroom, generate, watch line items assemble live with photo thumbnails attaching, receive a quote where every line cites a photo and at least one line shows the inferred flag, edit a quantity on device A and watch it update on device B within 2 seconds, send, open the share link in a desktop browser, accept, confirm the quote_events row and the status change on both devices.
4. `pnpm playwright test` green on the web quote page: renders from share token, Accept persists, invalid token 404s.
5. Agent trace screen shows all six nodes for the demo quote with non-zero durations and token counts on the LLM nodes, and the event timeline aligns with the live assembly the video captured.
6. Production AAB built via EAS, submitted to Google Play, and the listing is live and installable. Store listing copy passes the brand voice rules and links the public repo.
7. The 90-second painter demo video is recorded, following the story arc: walkthrough capture, live assembly, cross-device edit, client accept.
8. README limitations section explicitly names: fire-and-forget generation, no payments, no offline, seeded price books, demo-scale transcription, iOS simulator-only. Each with its upgrade path in one sentence.

verify.sh wires checks 1 and 2 into the Stop hook so build sessions self-gate. Checks 3 through 8 are the human acceptance pass; the repo flips public after check 3, the Play submission (check 6) starts immediately after, and the LinkedIn cycle waits for checks 6 and 7.
