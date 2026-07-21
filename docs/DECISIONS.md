# Decisions

Engineering decisions worth defending out loud: what was chosen, what was
rejected, and why. SPEC.md holds product and architecture decisions; this file
holds the smaller implementation calls that would otherwise only survive in a
commit message.

Newest first.

---

## 2026-07-21 — The service bundle is cached per process

**Decision.** `app/deps.py:get_services` is `@lru_cache`d, and the lazy Whisper
load inside `FasterWhisperTranscription._load` is double-checked under a
`threading.Lock`.

**Why.** `POST /generate` returns 202 and runs the pipeline in a FastAPI
`BackgroundTasks` threadpool thread. Without the cache every generation built a
fresh bundle, so the Whisper weights were re-read from disk on each run and N
concurrent generations held N copies. Measured at ~390MB resident for `base`,
two concurrent quotes would exhaust a 1GB instance. `_service_client` two
functions above was already cached this way, so the bundle was the outlier, not
the precedent.

**Alternatives considered.** A module-level singleton built at import time
(loads the model even for `/health` and breaks the tests' `dependency_overrides`
seam); caching only the transcription service (leaves a fresh Anthropic client
and its connection pool per request for no benefit); leaving it uncached and
sizing the host for the worst case (pays for RAM to work around a missing
decorator).

**Cost accepted.** The weights are now resident for the process lifetime rather
than transiently, so baseline RSS is permanently ~390MB. That is the right trade
against reloading them per run, but it is a floor, not an average.

**Proof.** `tests/test_service_bundle_caching.py`. Both tests were confirmed to
fail with their respective fix reverted, not merely to pass with it.

---

## 2026-07-21 — Whisper memory figures in SPEC are measured, not estimated

**Decision.** SPEC's transcription sizing claim was replaced with measured
numbers: `base` is 141MB on disk, ~390MB resident, ~455MB peak; `small` is 464MB
on disk, ~590MB resident, ~720MB peak. A 512MB instance fits neither.

**Why.** The spec had claimed since v1.1 that `base` was "roughly 300MB, fits
512MB instances". It was never measured and it is wrong in both directions: the
disk figure overstates by 2x and the RAM figure understates enough that any host
provisioned from it would have OOMed on the first transcription. A spec that
sizes infrastructure has to carry real numbers.

**Alternatives considered.** Deleting the sizing guidance entirely (leaves the
next reader with no basis to pick an instance); quoting a vendor's model card
(measures the weights, not the process, which is the number that actually
decides whether a host works).

**Caveat recorded honestly.** Measured on macOS against the committed 37s
fixture. Linux figures will differ somewhat; the 512MB verdict has enough margin
that the conclusion holds either way.
