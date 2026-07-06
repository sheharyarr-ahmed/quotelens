"""Service interfaces the pipeline depends on.

Nodes receive these through LangGraph runtime context (see
app.services.bundle.Services), so tests inject in-memory fakes and no node
ever reaches for the network directly.
"""

from typing import Protocol

from app.pipeline.schemas import Quote, TokenUsage, Transcript


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


class QuoteStore(Protocol):
    """Persists pipeline outcomes to quotes/quote_line_items so the failed
    state stays visible, GET /quotes reflects reality, and device-direct
    edit sync has rows to operate on."""

    def save_completed(self, quote: Quote, retry_count: int) -> None: ...

    def mark_failed(
        self, quote_id: str, errors: list[str], retry_count: int | None
    ) -> None: ...


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
