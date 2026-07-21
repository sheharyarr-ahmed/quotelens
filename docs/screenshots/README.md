# QuoteLens screenshots

Captured on an iPhone 17 Pro simulator (iOS 26.4), status bar pinned to 9:41.
Nothing here is mocked: every frame is the running app driving live Anthropic
vision and text models, faster-whisper transcription, hosted Supabase, and the
deployed Vercel quote page.

## The four hero shots

| File | Why it sells |
|---|---|
| 04-live-assembly.png | Line items streaming in live; subtotal caught mid-roll at $853.74 |
| 06-quote-completed.png | Every line cites a photo; one `inferred` badge, one `Unpriced` chip |
| 05-retry-retraction.png | The AI retracting its own draft: "Revising draft - attempt 1" |
| 13-agent-trace.png | Seven pipeline nodes, real durations, token counts, retry attempts |

## Full set, in story order

| File | Screen |
|---|---|
| 01-jobs-list.png | Jobs list with Accepted / Sent / Accepted badges |
| 02-new-job.png | New job modal, three trade price books |
| 03-stage-ticker.png | Seven-stage pipeline ticker mid-run |
| 04-live-assembly.png | Live assembly, rolling subtotal |
| 05-retry-retraction.png | Retry retraction, struck-through totals |
| 06-quote-completed.png | Completed quote with photo citations |
| 07-editor-sheet.png | Line-item editor, empty-price warning |
| 08-ready-to-send.png | All lines priced, Send unlocked, $1,096.00 |
| 09-share-sheet.png | Native share sheet with the public link |
| 10-sent.png | Sent chip, editing locked, Copy link |
| 11-web-client-view.png | Public web quote page with Accept button |
| 12-accepted.png | Realtime "client accepted" banner |
| 13-agent-trace.png | Agent trace with attempt grouping |

## What the run proved

- 49.2s end to end: transcription, vision, drafting, validation, finalize
- 5 line items, every one citing a photo
- "Replace window blinds" came back unpriced because it is absent from the
  seeded painting price book; Send stayed locked until it was priced
- Accept went through the deployed Vercel API against hosted Supabase:
  final status `accepted` with exactly one `quote_accepted` event
