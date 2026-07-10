# QuoteLens demo video runbook

The ~90-second painter demo, recorded on a **physical iPhone** against the
**Mac-LAN backend** (SPEC v1.4 Verification 3 and 7). The iPhone has a real
camera; the backend runs locally at full quality; the client Accept is shown in
a desktop browser against the hosted web page.

**Acceptance:** one continuous story: sign in, capture a water-damaged bedroom,
watch line items assemble live with **one visible retry retraction**, edit a
quantity and see it sync to a second device within 2 s, Send, open the share
link in a browser, Accept, see the Accepted banner sync back into the app.

---

## 0. Prerequisites (you)

- [ ] iPhone and Mac on the **same Wi-Fi** network.
- [ ] **Expo Go** installed on the iPhone (App Store). *(See §7 if it crashes: dev-build fallback.)*
- [ ] Mac firewall allows inbound connections on port **8000** (System Settings → Network → Firewall; allow the terminal/python binary, or turn the firewall off for the shoot).
- [ ] You have **signed into the app at least once** with your email, so the auth account exists.
- [ ] The **Vercel URL** is known (Phase B), needed for `EXPO_PUBLIC_WEB_URL`.
- [ ] A desktop browser open for the Accept shot; iOS **simulator** booted as the second device for the cross-device shot.

## 1. One-time env setup (`mobile/.env`, gitignored)

Metro inlines `EXPO_PUBLIC_*` at bundle time, so set these **before** starting Expo, then start with `--clear`.

```
# Mac's current LAN IP, verify each session (it changes between networks):
#   ipconfig getifaddr en0     (example today: 172.19.136.65)
EXPO_PUBLIC_API_URL=http://<MAC_LAN_IP>:8000       # NOT localhost; the phone must reach the Mac
EXPO_PUBLIC_WEB_URL=https://<your-vercel-url>       # so the share sheet emits a public /q/<token> link
# already correct from earlier sessions:
EXPO_PUBLIC_SUPABASE_URL=https://nxuchpuslgkuawfliqsj.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

## 2. Start the services

**Backend, LAN-bound (note `--host 0.0.0.0`, the default 127.0.0.1 is unreachable from the phone):**
```
set -a && source .env && set +a
cd backend && QUOTELENS_FORCE_RETRY=1 uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```
`QUOTELENS_FORCE_RETRY=1` seeds exactly one retry on the capture's generation so the retraction beat is
guaranteed on camera (attempt 2 re-drafts for real; the final quote is fully valid). Omit it for any take
that should not show a retry.

**Mobile (Metro over LAN; scan the QR in Expo Go):**
```
cd mobile && pnpm expo start --clear
```

**Second device (cross-device shot):** press `i` in the Expo CLI to open the iOS simulator, or just open the
same quote on an already-booted simulator once it exists.

**Smoke-test on the iPhone first** (before recording): app loads, camera + mic permission prompts appear, a
capture reaches the backend. If Expo Go crashes on launch, see §7.

## 3. Sign in

In the app: enter your email → **Send code** → type the emailed **6-digit** code (Brevo custom SMTP is configured).

Fallback if email is slow or unavailable: reach the code screen for the **same** email first, then:
```
cd backend && set -a && source ../.env && set +a
uv run python scripts/mint_login_code.py <your-email>     # prints a code; each request invalidates the prior one
```

## 4. Shot list (~90 s)

| # | ~t | Shot | Notes |
|---|----|------|-------|
| 1 | 0:00 | Sign in with the 6-digit code | Jobs list appears (empty or prior jobs) |
| 2 | 0:08 | **+ New job** → name it, pick **Painting** → lands in capture | client name = the homeowner |
| 3 | 0:15 | Walk-and-talk capture: **3 photos** of the water-damaged bedroom + **~45 s** narration | REC indicator + timer visible; thumbnails accumulate; each uploads eagerly |
| 4 | 0:45 | **Generate** → review screen, stage ticker (Transcribing ✓ / Analyzing ✓ / Drafting…) | driven by real `agent_traces` inserts |
| 5 | 0:55 | **Live assembly**: rows slide in, thumbnails attach, total ticks up | one line shows the **inferred** flag on a vision-estimated quantity |
| 6 | 1:05 | **Retry retraction**: drafted rows dim into the revising state (attempt 2), corrected items stream fresh | the forced retry; the honest self-correction moment |
| 7 | 1:15 | **Cross-device edit**: edit a quantity on the iPhone → the **simulator** (same quote open) updates **< 2 s** | the two-device sync shot |
| 8 | 1:22 | **Send** → native share sheet with the `/q/<token>` link | editing locks read-only; Sent badge |
| 9 | 1:28 | **Desktop browser** opens the link → the quote renders → click **Accept** | server-side render from hosted Supabase |
| 10 | 1:33 | Back in the app: **Accepted banner** overlays (realtime `quote_accepted`) | closes the loop |

Optional B-roll (supports Verification 5, not required in the 90 s): open the **agent trace** screen showing seven
nodes, durations, token badges on the LLM nodes, the retry as a second attempt group.

## 5. Export the GIF

Trim to ~90 s in QuickTime/Photos, export `docs/demo.mp4`, then:
```
# High-quality palette-based GIF, ~640px wide, 12fps (small, crisp):
cd docs
ffmpeg -i demo.mp4 -vf "fps=12,scale=640:-1:flags=lanczos,palettegen" -y palette.png
ffmpeg -i demo.mp4 -i palette.png -lavfi "fps=12,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse" -y demo.gif
```
Commit `docs/demo.gif`; the README embeds it. (If the GIF is large, keep the mp4 out of git and link the GIF only.)

## 6. After the shoot: reset the web sample

The demo's own Accept (shot 9) burns the app's real quote, not the sample. But if you clicked Accept on the
**sample** link while testing, reset it:
```
cd backend && set -a && source ../.env && set +a
uv run python scripts/seed_web_sample.py     # flips /q/sample-water-damaged-bedroom back to 'sent'
```

## 7. Troubleshooting

- **Phone can't reach the backend** (Generate hangs / network error): confirm `EXPO_PUBLIC_API_URL` is the Mac's
  LAN IP (not localhost), the backend started with `--host 0.0.0.0`, both devices are on the same Wi-Fi, and the
  firewall allows port 8000. Test from the phone's browser: `http://<MAC_LAN_IP>:8000/health`.
- **Retry didn't appear**: the backend must have been started with `QUOTELENS_FORCE_RETRY=1` in its environment.
- **Expo Go crashes on launch** (native module mismatch, Reanimated 4.5 / worklets under SDK 57): fall back to a
  **local dev build** on the tethered iPhone: `cd mobile && npx expo run:ios --device`. This is a development
  build, not an EAS/store build, so it stays within SPEC v1.4 scope; it adds native project files locally.
- **No camera on the machine** (simulator-only rehearsal): drive the pipeline over the committed fixtures instead:
  `uv run python scripts/seed_live_demo.py seed` → open the "Generating" job in the app → `... seed_live_demo.py run <QUOTE_ID>`.
