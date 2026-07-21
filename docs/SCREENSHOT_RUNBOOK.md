# QuoteLens screenshot runbook

How to reproduce the walkthrough in `docs/screenshots/` (SPEC v1.5,
Verification 3 and 7). Everything runs on the iOS simulator against the backend
on localhost. The v1.4 physical-iPhone shoot was dropped: the available Wi-Fi
client-isolates devices, so the phone could never reach the Mac's FastAPI.

**What the run proves:** sign in, a job whose capture media is seeded from the
committed fixtures, a real pipeline run, live assembly with one visible retry
retraction, priced-to-unlock Send, the public web page, and Accept syncing back
into the app as a realtime banner.

**What it deliberately does not show:** the capture screen. The simulator has no
camera, `mobile/app/capture/[jobId].tsx` renders a dead `CameraView` with a
permanently disabled shutter, and there is no photo-library fallback. That path
is covered by tests and `mobile/scripts/live-verify.ts`.

---

## 0. Prerequisites

- Repo-root `.env` populated (see `.env.example`).
- `mobile/.env` has `EXPO_PUBLIC_API_URL=http://localhost:8000`.
- You have signed into the app at least once, so the auth user exists.

## 1. Boot the simulator with a clean status bar

```bash
xcrun simctl boot "iPhone 17 Pro"
open -a Simulator
xcrun simctl status_bar booted override \
  --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3
```

## 2. Start the services

Two terminals, both left open.

```bash
set -a && source .env && set +a
cd backend && uv run uvicorn app.main:app --port 8000
```

```bash
cd mobile && pnpm expo start --clear
```

Open the app with `xcrun simctl openurl booted "exp://127.0.0.1:8081"`, or press
`i` in the Expo CLI.

## 3. Hide Expo Go's dev chrome

Expo Go floats a **Tools** gear over the top-right of every screen. It must not
appear in a screenshot.

1. Tap the gear, scroll the sheet, toggle **Tools button** off, close the sheet.
2. If you also toggle the element inspector by accident, reopen the dev menu with
   **Control-Command-Z** (Device > Shake) and turn it off.

## 4. Create the job

New job > name it > pick **Residential Painting** > **Start capture**. The
capture screen is a dead black viewfinder on the simulator; that is expected.
Swipe back from the left edge and confirm **Discard**. The job row survives
(`session.discard()` removes only that session's captures), which is what the
seed script needs: a job with no quote yet.

## 5. Seed the capture media

```bash
cd backend && set -a && source ../.env && set +a
uv run python scripts/seed_live_demo.py seed
```

It uploads the two fixture photos and the voice note from
`backend/tests/fixtures/`, creates the quote at status `generating`, and prints
a `QUOTE_ID=` line. Copy it.

In the app: pull to refresh the Jobs list and tap the card, now badged
**Generating**. You should be looking at the stage ticker. Do not navigate away.
The client has to be subscribed before the pipeline emits, or live assembly is
missed.

## 6. Run the pipeline and burst-capture

The retry retraction lasts seconds and disappears the instant generation
completes, so capture continuously rather than trying to time it by hand.

```bash
cd backend && set -a && source ../.env && set +a
mkdir -p /tmp/burst
QUOTELENS_FORCE_RETRY=1 uv run python scripts/seed_live_demo.py run <QUOTE_ID> &
RUNPID=$!
i=0
while kill -0 $RUNPID 2>/dev/null; do
  i=$((i+1))
  xcrun simctl io booted screenshot /tmp/burst/f$(printf "%03d" $i).png
  sleep 0.15
done
```

`QUOTELENS_FORCE_RETRY=1` must be on **this** command. The script calls
`graph.invoke` in its own process and never goes through uvicorn, so setting it
on the server does nothing.

Find the retraction frame by colour rather than by eye. The banner is
`warningLight` (`#FEF3C7`) and occupies a wide block near the top:

```bash
uv run --with pillow python - <<'PY'
from PIL import Image
import glob, os
for f in sorted(glob.glob('/tmp/burst/*.png')):
    im = Image.open(f).convert('RGB'); im = im.resize((im.width//4, im.height//4))
    px, (w, h) = im.load(), im.size
    top = sum(1 for y in range(0, int(h*0.45), 2) for x in range(0, w, 2)
              if all(abs(px[x, y][c] - (254, 243, 199)[c]) < 6 for c in range(3)))
    if top: print(os.path.basename(f), top)
PY
```

The frames with a few hundred matches are the retraction.

## 7. The remaining shots

Re-enter the quote from the Jobs list first, so the photo-citation thumbnails
have time to fetch their signed URLs. Then, in order:

1. Completed quote.
2. Tap the unpriced row for the editor sheet.
3. Price it, Save, and shoot the unlocked Send state.
4. Send, and shoot the share sheet and the `Sent` state.
5. Capture the public page headlessly:
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot=out.png <share url>`
6. Accept it. Either click the button in a browser or
   `curl -X POST <vercel>/api/accept -H 'Content-Type: application/json' -d '{"share_token":"..."}'`.
   The app shows the green banner over realtime with no interaction.
7. Agent trace. If the accepted banner covers the link, navigate directly:
   `xcrun simctl openurl booted "exp://127.0.0.1:8081/--/quote/<QUOTE_ID>/trace"`.
   That reloads the bundle, which takes about 25 seconds.

## 8. Confirm the invariants in the database

Check the quote row and its `quote_events`: status `accepted` with exactly one
`quote_accepted` event, one `line_item_drafted` per line in emission order, and
the `retry_started` row. That is what makes the stills provably the events the
pipeline actually emitted rather than a staged animation (Verification 5).

## 9. Reset the public sample

If you accepted the shared sample rather than your own quote, put it back:

```bash
cd backend && set -a && source ../.env && set +a
uv run python scripts/seed_web_sample.py
```

## Troubleshooting

- **Tools gear in a screenshot.** Section 3. Re-shoot; it cannot be cropped out.
- **No retry retraction.** `QUOTELENS_FORCE_RETRY=1` was not on the `run` command.
- **Blank citation thumbnails.** Signed URLs had not resolved. Leave the quote and
  re-enter it, then wait a few seconds.
- **Pipeline dies with `httpx.ReadTimeout`.** Slow Storage egress. Media fetches
  carry a 60s timeout (`MEDIA_FETCH_TIMEOUT`); raise it if your link is slower.
- **Stale API URL.** Metro inlines `EXPO_PUBLIC_*` at bundle time. After editing
  `mobile/.env`, restart with `--clear`.
