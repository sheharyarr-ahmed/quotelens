"""Regression tests for findings confirmed by the session-1 adversarial
review: quote persistence, degenerate empty drafts, and lax-coerced
numeric-string quantities."""

from fastapi.testclient import TestClient

from app.auth import get_current_user_id
from app.deps import get_repo, get_services
from app.main import app
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


def test_completed_quote_is_persisted(happy_services):
    graph.invoke(initial_state(), context=happy_services)

    assert len(happy_services.quotes.completed) == 1
    quote, retry_count = happy_services.quotes.completed[0]
    assert quote.status == "completed"
    assert len(quote.line_items) == 2
    assert retry_count == 0
    assert happy_services.quotes.failed == []


def test_failed_quote_is_persisted_with_errors():
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
    assert services.quotes.completed == []
    assert len(services.quotes.failed) == 1
    quote_id, errors, retry_count = services.quotes.failed[0]
    assert quote_id == "quote-1"
    assert errors
    assert retry_count == 2


def test_empty_draft_fails_validation_and_retries():
    """An empty line_items draft must trip the retry edge, not sail through
    as a completed empty quote."""
    services = build_services(
        [PARSE_RESPONSE, MATCH_RESPONSE, {"line_items": []}, GOOD_DRAFT_RESPONSE]
    )
    result = graph.invoke(initial_state(), context=services)

    assert result["status"] == "completed"
    assert result["retry_count"] == 1
    assert len(result["quote"].line_items) == 2
    assert services.events.types().count(events.RETRY_STARTED) == 1


def test_numeric_string_quantity_still_gets_priced():
    """Pydantic's lax mode coerces '336' to a float downstream, so the
    draft node must price it the same way instead of leaving
    total_cents=None on a completed quote."""
    draft = {
        "line_items": [
            {
                **GOOD_DRAFT_RESPONSE["line_items"][0],
                "quantity": "336",
            },
            GOOD_DRAFT_RESPONSE["line_items"][1],
        ]
    }
    services = build_services([PARSE_RESPONSE, MATCH_RESPONSE, draft])
    result = graph.invoke(initial_state(), context=services)

    assert result["status"] == "completed"
    first = result["quote"].line_items[0]
    assert first.total_cents == 336 * 180
    assert result["quote"].subtotal_cents == 336 * 180 + 168 * 95


def test_generate_rejects_foreign_job():
    """Service-role access bypasses RLS, so /generate must 404 a job id the
    verified user does not own."""
    services = build_services([])
    from tests.test_routes import FakeRepo

    app.dependency_overrides = {
        get_current_user_id: lambda: "user-1",
        get_repo: FakeRepo,
        get_services: lambda: services,
    }
    try:
        client = TestClient(app)
        response = client.post(
            "/generate",
            json={"job_id": "someone-elses-job", "audio_path": "a", "photos": []},
        )
        assert response.status_code == 404
        assert services.events.events == []
    finally:
        app.dependency_overrides = {}
