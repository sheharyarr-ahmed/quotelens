import os
import threading

from app.pipeline.schemas import Transcript

# Signed-Storage media fetches, not API calls: httpx's 5s default aborts a
# walkthrough recording whenever Storage egress is slow, failing the whole run.
MEDIA_FETCH_TIMEOUT = 60.0


class FasterWhisperTranscription:
    """In-process transcription. WHISPER_MODEL sizes the model per deploy:
    `small` locally and for the screenshot walkthrough, `base` on the free tier
    (SPEC.md - Pipeline). Lazy import keeps ctranslate2 out of test runs."""

    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or os.environ.get("WHISPER_MODEL", "small")
        self._model = None
        self._load_lock = threading.Lock()

    def _load(self):
        # get_services is process-cached, so one instance is shared by every
        # generation and BackgroundTasks runs them on threadpool threads. A bare
        # check-then-act here lets two threads each build a model, briefly
        # doubling resident weights - the OOM the shared bundle exists to avoid.
        if self._model is None:
            with self._load_lock:
                if self._model is None:
                    from faster_whisper import WhisperModel

                    self._model = WhisperModel(
                        self.model_name, compute_type="int8"
                    )
        return self._model

    def transcribe(self, audio_path: str) -> Transcript:
        model = self._load()
        source = audio_path
        if audio_path.startswith(("http://", "https://")):
            # faster-whisper takes a local path or file-like object, not a
            # URL; the pipeline hands us a signed Storage URL.
            import io

            import httpx

            response = httpx.get(audio_path, timeout=MEDIA_FETCH_TIMEOUT)
            source = io.BytesIO(response.content)
        segments, info = model.transcribe(source)
        text = " ".join(segment.text.strip() for segment in segments)
        return Transcript(text=text, duration_seconds=info.duration)
