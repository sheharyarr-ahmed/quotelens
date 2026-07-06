"""Shared pipeline fixtures: a painter walkthrough of a water-damaged
bedroom, scripted through the fake services."""

import pytest

from app.pipeline.schemas import PhotoObservation, PhotoRef, PriceBookItem, Transcript
from app.services.bundle import Services
from tests.fakes import (
    FakeLLM,
    FakeStorage,
    FakeTranscription,
    InMemoryEventSink,
    InMemoryTraceWriter,
)

PHOTOS = [
    PhotoRef(photo_id="photo-1", storage_path="u1/j1/photo-1.jpg"),
    PhotoRef(photo_id="photo-2", storage_path="u1/j1/photo-2.jpg"),
    PhotoRef(photo_id="photo-3", storage_path="u1/j1/photo-3.jpg"),
]

PRICE_BOOK = [
    PriceBookItem(
        id="pb-wall-paint",
        name="Interior wall paint, 2 coats",
        unit="sqft",
        unit_price_cents=180,
    ),
    PriceBookItem(
        id="pb-ceiling-primer",
        name="Stain-blocking ceiling primer",
        unit="sqft",
        unit_price_cents=95,
    ),
    PriceBookItem(
        id="pb-drywall-patch",
        name="Drywall patch, up to 2 sqft",
        unit="each",
        unit_price_cents=8500,
    ),
]

# Vision responses keyed by the FakeStorage signed url for each photo.
VISION_RESPONSES = {
    f"https://fake.storage/signed/{photo.storage_path}": {
        "surfaces": ["walls", "ceiling"],
        "damage": ["water stain"],
        "room": "bedroom",
        "dimensions_estimate": "12x14 ft",
        "notes": None,
    }
    for photo in PHOTOS
}

PARSE_RESPONSE = {
    "tasks": [
        {
            "description": "Paint bedroom walls, 2 coats",
            "quantity": 336,
            "unit": "sqft",
            "source": "stated",
        },
        {
            "description": "Prime water-stained ceiling",
            "quantity": None,
            "unit": None,
            "source": "inferred",
        },
    ]
}

MATCH_RESPONSE = {
    "matches": [
        {"task_index": 0, "price_book_item_id": "pb-wall-paint"},
        {"task_index": 1, "price_book_item_id": "pb-ceiling-primer"},
    ]
}

GOOD_DRAFT_RESPONSE = {
    "line_items": [
        {
            "description": "Paint bedroom walls, 2 coats",
            "quantity": 336,
            "unit": "sqft",
            "price_book_item_id": "pb-wall-paint",
            "photo_citations": ["photo-1", "photo-2"],
            "confidence": "stated",
        },
        {
            "description": "Prime water-stained ceiling",
            "quantity": 168,
            "unit": "sqft",
            "price_book_item_id": "pb-ceiling-primer",
            "photo_citations": ["photo-3"],
            "confidence": "inferred",
        },
    ]
}

# Invalid: first item carries no citations, which must trip the retry edge.
UNCITED_DRAFT_RESPONSE = {
    "line_items": [
        {
            **GOOD_DRAFT_RESPONSE["line_items"][0],
            "photo_citations": [],
        },
        GOOD_DRAFT_RESPONSE["line_items"][1],
    ]
}

# Invalid: cites a photo id the vision node never analyzed.
UNKNOWN_CITATION_DRAFT_RESPONSE = {
    "line_items": [
        {
            **GOOD_DRAFT_RESPONSE["line_items"][0],
            "photo_citations": ["photo-99"],
        },
        GOOD_DRAFT_RESPONSE["line_items"][1],
    ]
}

CACHED_TRANSCRIPT = Transcript(text="cached walkthrough", duration_seconds=45.0)
CACHED_OBSERVATIONS = [
    PhotoObservation(
        photo_id=photo.photo_id,
        surfaces=["walls"],
        damage=["water stain"],
        room="bedroom",
        dimensions_estimate="12x14 ft",
    )
    for photo in PHOTOS
]


def initial_state(**overrides) -> dict:
    base = {
        "job_id": "job-1",
        "quote_id": "quote-1",
        "audio_path": "u1/j1/narration.m4a",
        "photos": PHOTOS,
        "price_book_items": PRICE_BOOK,
    }
    return {**base, **overrides}


def build_services(completion_responses: list[dict]) -> Services:
    return Services(
        transcription=FakeTranscription(),
        llm=FakeLLM(
            responses=completion_responses, vision_responses=VISION_RESPONSES
        ),
        storage=FakeStorage(),
        events=InMemoryEventSink(),
        traces=InMemoryTraceWriter(),
    )


@pytest.fixture
def happy_services() -> Services:
    return build_services([PARSE_RESPONSE, MATCH_RESPONSE, GOOD_DRAFT_RESPONSE])
