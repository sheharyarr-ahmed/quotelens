"""The service bundle passed to the pipeline as LangGraph runtime context."""

from dataclasses import dataclass

from app.services.protocols import (
    EventSink,
    LLMService,
    StorageService,
    TraceWriter,
    TranscriptionService,
)


@dataclass
class Services:
    transcription: TranscriptionService
    llm: LLMService
    storage: StorageService
    events: EventSink
    traces: TraceWriter
