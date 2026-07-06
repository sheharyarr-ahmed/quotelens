"""Service interfaces the pipeline depends on.

Nodes receive these through LangGraph runtime context (see
app.services.bundle.Services), so tests inject in-memory fakes and no node
ever reaches for the network directly.
"""

from typing import Protocol

from app.pipeline.schemas import TokenUsage, Transcript


class TranscriptionService(Protocol):
    def transcribe(self, audio_path: str) -> Transcript: ...


class LLMService(Protocol):
    def complete_json(self, *, prompt: str, model: str) -> tuple[dict, TokenUsage]:
        """Text completion that returns a parsed JSON object plus usage."""
        ...

    def analyze_image_json(
        self, *, prompt: str, image_url: str, model: str
    ) -> tuple[dict, TokenUsage]:
        """Vision completion over one image, returning parsed JSON plus usage."""
        ...


class StorageService(Protocol):
    def create_signed_url(self, path: str, expires_in: int = 3600) -> str: ...


class EventSink(Protocol):
    def emit(self, quote_id: str, event_type: str, payload: dict) -> None: ...


class TraceWriter(Protocol):
    def record(
        self,
        quote_id: str,
        node: str,
        input: dict,
        output: dict,
        duration_ms: int,
        tokens: TokenUsage | None,
    ) -> None: ...
