from typing import Literal

from pydantic import BaseModel

from app.pipeline.schemas import (
    PhotoObservation,
    PhotoRef,
    PriceBookItem,
    PriceBookMatch,
    Quote,
    Transcript,
    WalkthroughTask,
)


class PipelineState(BaseModel):
    """LangGraph state for one generation run.

    transcribe and analyze_photos run in parallel and must write disjoint
    keys (transcript vs observations) — overlapping writes from parallel
    branches raise InvalidUpdateError without a reducer.

    draft_items stays raw dicts on purpose: an invalid draft (e.g. empty
    photo_citations) must be representable in state so the validate node can
    reject it and fire the retry edge. Pydantic parsing into QuoteLineItem
    happens in validate/compile_quote.
    """

    job_id: str
    quote_id: str
    audio_path: str | None = None
    photos: list[PhotoRef] = []
    price_book_items: list[PriceBookItem] = []

    # transcribe / analyze_photos outputs; pre-populated on regenerate so the
    # entry router skips both nodes and no transcription or vision is re-paid.
    transcript: Transcript | None = None
    observations: list[PhotoObservation] | None = None

    parsed_tasks: list[WalkthroughTask] | None = None
    matches: list[PriceBookMatch] | None = None
    draft_items: list[dict] | None = None

    validation_errors: list[str] = []
    retry_count: int = 0
    status: Literal["generating", "completed", "failed"] = "generating"
    quote: Quote | None = None
