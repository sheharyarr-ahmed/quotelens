"""The QUOTELENS_FORCE_RETRY seam: a default-off env flag that seeds exactly
one retry so the recorded demo can show the honest retraction beat
(SPEC.md - Verification 7). It must fire the retry edge once on an otherwise
valid draft and still finish with a fully valid quote, and it must be inert
when unset (zero behavior change in normal runs)."""

from app.pipeline import events
from app.pipeline.graph import graph
from tests.conftest import (
    GOOD_DRAFT_RESPONSE,
    MATCH_RESPONSE,
    PARSE_RESPONSE,
    build_services,
    initial_state,
)


def test_force_retry_flag_seeds_one_retraction(monkeypatch):
    """With the flag on, a clean first draft is rejected exactly once; the
    second real pass validates normally and the quote completes."""
    monkeypatch.setenv("QUOTELENS_FORCE_RETRY", "1")
    # Both drafts are valid; the retry is forced by the flag, not by the draft.
    services = build_services(
        [PARSE_RESPONSE, MATCH_RESPONSE, GOOD_DRAFT_RESPONSE, GOOD_DRAFT_RESPONSE]
    )
    result = graph.invoke(initial_state(), context=services)

    assert result["status"] == "completed"
    assert result["retry_count"] == 1
    assert result["quote"] is not None  # final quote is fully valid

    types = services.events.types()
    assert types.count(events.RETRY_STARTED) == 1
    # Drafted rows stream, retract, then re-stream fresh - the demo choreography.
    assert types == [
        events.LINE_ITEM_DRAFTED,
        events.LINE_ITEM_DRAFTED,
        events.RETRY_STARTED,
        events.LINE_ITEM_DRAFTED,
        events.LINE_ITEM_DRAFTED,
        events.GENERATION_COMPLETED,
    ]
    # The retry reason is the forced marker, surfaced honestly in the trace.
    retry_payload = next(
        payload
        for _, event_type, payload in services.events.events
        if event_type == events.RETRY_STARTED
    )
    assert any(
        "QUOTELENS_FORCE_RETRY" in error for error in retry_payload["errors"]
    )


def test_default_off_no_forced_retry(monkeypatch):
    """Unset (the production default): the same clean draft sails through with
    no retry - proving the seam is inert unless a human turns it on."""
    monkeypatch.delenv("QUOTELENS_FORCE_RETRY", raising=False)
    services = build_services([PARSE_RESPONSE, MATCH_RESPONSE, GOOD_DRAFT_RESPONSE])
    result = graph.invoke(initial_state(), context=services)

    assert result["status"] == "completed"
    # No retry fired, so validate never wrote retry_count; it stays the state
    # default of 0.
    assert result.get("retry_count", 0) == 0
    assert services.events.types().count(events.RETRY_STARTED) == 0
