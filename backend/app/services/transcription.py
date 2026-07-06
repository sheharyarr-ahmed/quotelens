import os

from app.pipeline.schemas import Transcript


class FasterWhisperTranscription:
    """In-process transcription. WHISPER_MODEL sizes the model per deploy:
    `small` locally and for the demo video, `base` on the free tier
    (SPEC.md - Pipeline). Lazy import keeps ctranslate2 out of test runs."""

    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or os.environ.get("WHISPER_MODEL", "small")
        self._model = None

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(self.model_name, compute_type="int8")
        return self._model

    def transcribe(self, audio_path: str) -> Transcript:
        model = self._load()
        segments, info = model.transcribe(audio_path)
        text = " ".join(segment.text.strip() for segment in segments)
        return Transcript(text=text, duration_seconds=info.duration)
