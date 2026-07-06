from app.pipeline import events
from app.pipeline.graph import graph
from tests.conftest import (
    GOOD_DRAFT_RESPONSE,
    MATCH_RESPONSE,
    PARSE_RESPONSE,
    UNCITED_DRAFT_RESPONSE,
    build_services,
    initial_state,
)


def test_retry_then_success():
    """Retry edge fires on a seeded invalid draft and succeeds on the
    second pass (SPEC.md - Verification 1)."""
    services = build_services(
        [PARSE_RESPONSE, MATCH_RESPONSE, UNCITED_DRAFT_RESPONSE, GOOD_DRAFT_RESPONSE]
    )
    result = graph.invoke(initial_state(), context=services)

    assert result["status"] == "completed"
    assert result["retry_count"] == 1
    assert result["quote"] is not None

    types = services.events.types()
    assert types.count(events.RETRY_STARTED) == 1
    # First (retracted) draft streamed, then the corrected items stream fresh.
    assert types == [
        events.LINE_ITEM_DRAFTED,
        events.LINE_ITEM_DRAFTED,
        events.RETRY_STARTED,
        events.LINE_ITEM_DRAFTED,
        events.LINE_ITEM_DRAFTED,
        events.GENERATION_COMPLETED,
    ]


def test_retry_cap_exhaustion():
    """Retry cap halts at 2 and surfaces a failed quote with the last draft
    preserved (SPEC.md - Verification 1)."""
    services = build_services(
        [
            PARSE_RESPONSE,
            MATCH_RESPONSE,
            UNCITED_DRAFT_RESPONSE,
            UNCITED_DRAFT_RESPONSE,
            UNCITED_DRAFT_RESPONSE,
        ]
    )
    result = graph.invoke(initial_state(), context=services)

    assert result["status"] == "failed"
    assert result["retry_count"] == 2
    assert result.get("quote") is None
    # The broken draft stays visible for the failed-state UI.
    assert result["draft_items"], "last draft must be preserved on failure"
    assert result["validation_errors"]

    types = services.events.types()
    assert types.count(events.RETRY_STARTED) == 2
    assert types[-1] == events.GENERATION_FAILED
    assert events.GENERATION_COMPLETED not in types
    # Three draft passes streamed: initial plus two retries.
    assert types.count(events.LINE_ITEM_DRAFTED) == 6
