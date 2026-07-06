"""Quote schema and pipeline data models.

The Quote/QuoteLineItem models are the single source of truth for the quote
schema. `schema/quote.schema.json` is generated from them via
`scripts/export_schema.py` and the Zod mirror on mobile is tested against
that artifact (SPEC.md - Quote schema and integrity).
"""

import json
from typing import Literal

from pydantic import BaseModel, Field

Unit = Literal["sqft", "linear_ft", "each", "flat"]
Confidence = Literal["stated", "inferred"]
QuoteStatus = Literal["generating", "completed", "failed", "sent", "accepted"]


class QuoteLineItem(BaseModel):
    """One priced line of a quote.

    photo_citations is non-empty by schema constraint, not by prompt: an
    uncited line item fails validation and never reaches the UI.
    """

    description: str
    quantity: float = Field(gt=0)
    unit: Unit
    # None means the price book had no match; renders as `unpriced`,
    # never a guessed number.
    price_book_item_id: str | None = None
    unit_price_cents: int | None = Field(default=None, ge=0)
    total_cents: int | None = Field(default=None, ge=0)
    photo_citations: list[str] = Field(min_length=1)
    confidence: Confidence


class Quote(BaseModel):
    id: str
    job_id: str
    status: QuoteStatus
    line_items: list[QuoteLineItem]
    subtotal_cents: int = Field(ge=0)


def quote_schema_json() -> str:
    """Canonical serialization of the quote JSON Schema.

    Used by both scripts/export_schema.py and the artifact drift test;
    sort_keys makes the output independent of Pydantic's key ordering.
    """
    return json.dumps(Quote.model_json_schema(), indent=2, sort_keys=True) + "\n"


# --- Internal pipeline models (not part of the client-facing artifact) ---


class PhotoRef(BaseModel):
    photo_id: str
    storage_path: str


class Transcript(BaseModel):
    text: str
    duration_seconds: float | None = None


class PhotoObservation(BaseModel):
    """Structured output of the analyze_photos vision node for one photo."""

    photo_id: str
    surfaces: list[str] = []
    damage: list[str] = []
    room: str | None = None
    dimensions_estimate: str | None = None
    notes: str | None = None


class WalkthroughTask(BaseModel):
    """One unit of work extracted from the narration by parse_walkthrough."""

    description: str
    quantity: float | None = None
    unit: Unit | None = None
    source: Confidence = "stated"


class PriceBookItem(BaseModel):
    id: str
    name: str
    unit: Unit
    unit_price_cents: int = Field(ge=0)
    description: str | None = None


class PriceBookMatch(BaseModel):
    """match_pricebook output: an existing item id or None (unpriced)."""

    task_index: int
    price_book_item_id: str | None = None


class TokenUsage(BaseModel):
    input_tokens: int
    output_tokens: int
