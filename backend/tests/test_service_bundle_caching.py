"""The service bundle is built once per process, and the Whisper model inside
it is constructed once even under concurrency.

Both matter for hosting: /generate returns 202 and runs the pipeline in a
BackgroundTasks threadpool thread, so without a process-level cache every
generation rebuilds FasterWhisperTranscription and re-reads the weights from
disk, and N concurrent generations hold N copies (roughly 415MB each for
`base`). A 1GB instance dies at two concurrent quotes."""

import sys
import threading
import types

from app import deps
from app.services.transcription import FasterWhisperTranscription


def test_get_services_is_process_cached(monkeypatch):
    """Two requests share one bundle, so the model is loaded once, not twice."""
    calls = []

    def counting_factory():
        calls.append(1)
        return object()

    monkeypatch.setattr(deps, "build_services_from_env", counting_factory)
    deps.get_services.cache_clear()
    try:
        first = deps.get_services()
        second = deps.get_services()
    finally:
        deps.get_services.cache_clear()

    assert first is second
    assert len(calls) == 1


def test_concurrent_transcribe_builds_exactly_one_model(monkeypatch):
    """The lazy load is double-checked under a lock: eight threads racing into
    _load must not each construct a model, which is what would briefly double
    resident weights and OOM a small instance."""
    built = []
    ready = threading.Barrier(8)

    class SlowFakeWhisperModel:
        def __init__(self, model_name, compute_type):
            # Widen the check-then-act window so an unlocked implementation
            # reliably fails this test rather than failing it one run in fifty.
            built.append(model_name)
            threading.Event().wait(0.05)

    fake_module = types.ModuleType("faster_whisper")
    fake_module.WhisperModel = SlowFakeWhisperModel
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_module)

    service = FasterWhisperTranscription(model_name="base")

    def load():
        ready.wait()
        service._load()

    threads = [threading.Thread(target=load) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert built == ["base"]
