from app.pipeline import events
from app.pipeline.graph import graph
from tests.conftest import (
    GOOD_DRAFT_RESPONSE,
    MATCH_RESPONSE,
    PARSE_RESPONSE,
    UNKNOWN_CITATION_DRAFT_RESPONSE,
    build_services,
    initial_state,
)


def test_unknown_photo_citation_fails():
    """Validate rejects a citation naming a photo id absent from the
    observation set (SPEC.md - Verification 1): the citation is well-formed
    per JSON Schema, so only the observation cross-check can catch it."""
    services = build_services(
        [
            PARSE_RESPONSE,
            MATCH_RESPONSE,
            UNKNOWN_CITATION_DRAFT_RESPONSE,
            GOOD_DRAFT_RESPONSE,
        ]
    )
    result = graph.invoke(initial_state(), context=services)

    # The unknown citation forced exactly one retry before succeeding.
    assert result["status"] == "completed"
    assert result["retry_count"] == 1

    retry_events = [
        payload
        for _, event_type, payload in services.events.events
        if event_type == events.RETRY_STARTED
    ]
    assert len(retry_events) == 1
    assert any("photo-99" in error for error in retry_events[0]["errors"])
