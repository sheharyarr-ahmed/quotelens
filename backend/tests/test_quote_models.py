import pytest
from pydantic import ValidationError

from app.pipeline.schemas import Quote, QuoteLineItem


def line_item(**overrides) -> dict:
    base = {
        "description": "Interior wall paint, 2 coats",
        "quantity": 336.0,
        "unit": "sqft",
        "price_book_item_id": "pb-1",
        "unit_price_cents": 180,
        "total_cents": 60480,
        "photo_citations": ["photo-1"],
        "confidence": "stated",
    }
    return {**base, **overrides}


def test_empty_citations_rejected():
    with pytest.raises(ValidationError, match="photo_citations"):
        QuoteLineItem(**line_item(photo_citations=[]))


def test_missing_citations_rejected():
    payload = line_item()
    del payload["photo_citations"]
    with pytest.raises(ValidationError, match="photo_citations"):
        QuoteLineItem(**payload)


def test_unknown_unit_rejected():
    with pytest.raises(ValidationError, match="unit"):
        QuoteLineItem(**line_item(unit="hour"))


def test_unknown_confidence_rejected():
    with pytest.raises(ValidationError, match="confidence"):
        QuoteLineItem(**line_item(confidence="guessed"))


def test_unpriced_item_is_valid():
    item = QuoteLineItem(
        **line_item(price_book_item_id=None, unit_price_cents=None, total_cents=None)
    )
    assert item.price_book_item_id is None
    assert item.unit_price_cents is None


def test_quote_roundtrip():
    quote = Quote(
        id="q-1",
        job_id="j-1",
        status="completed",
        line_items=[QuoteLineItem(**line_item())],
        subtotal_cents=60480,
    )
    assert Quote.model_validate(quote.model_dump()) == quote


def test_invalid_status_rejected():
    with pytest.raises(ValidationError, match="status"):
        Quote(
            id="q-1",
            job_id="j-1",
            status="draft",
            line_items=[],
            subtotal_cents=0,
        )
