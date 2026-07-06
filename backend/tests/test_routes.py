"""Route smoke test: /generate runs the pipeline end to end through the API
surface with all dependencies overridden by fakes."""

from fastapi.testclient import TestClient

from app.auth import get_current_user_id
from app.deps import get_repo, get_services
from app.main import app
from app.pipeline import events
from tests.conftest import PRICE_BOOK, build_services
from tests.conftest import GOOD_DRAFT_RESPONSE, MATCH_RESPONSE, PARSE_RESPONSE


class FakeRepo:
    def create_quote(self, user_id: str, job_id: str) -> dict:
        return {"id": "quote-1", "user_id": user_id, "job_id": job_id}

    def get_active_price_book_items(self, user_id: str):
        return PRICE_BOOK

    def register_capture(self, user_id, job_id, kind, storage_path) -> dict:
        return {
            "id": "capture-1",
            "job_id": job_id,
            "kind": kind,
            "storage_path": storage_path,
        }


def test_health():
    client = TestClient(app)
    assert client.get("/health").json() == {"status": "ok"}


def test_generate_smoke():
    services = build_services([PARSE_RESPONSE, MATCH_RESPONSE, GOOD_DRAFT_RESPONSE])
    app.dependency_overrides = {
        get_current_user_id: lambda: "user-1",
        get_repo: FakeRepo,
        get_services: lambda: services,
    }
    try:
        client = TestClient(app)
        response = client.post(
            "/generate",
            json={
                "job_id": "job-1",
                "audio_path": "u1/j1/narration.m4a",
                "photos": [
                    {"photo_id": "photo-1", "storage_path": "u1/j1/photo-1.jpg"},
                    {"photo_id": "photo-2", "storage_path": "u1/j1/photo-2.jpg"},
                    {"photo_id": "photo-3", "storage_path": "u1/j1/photo-3.jpg"},
                ],
            },
        )
        assert response.status_code == 202
        assert response.json() == {"quote_id": "quote-1"}
        # TestClient runs BackgroundTasks before returning: the pipeline
        # completed and streamed its events.
        assert services.events.types()[-1] == events.GENERATION_COMPLETED
    finally:
        app.dependency_overrides = {}


def test_generate_requires_auth():
    client = TestClient(app)
    response = client.post(
        "/generate",
        json={"job_id": "job-1", "audio_path": "a", "photos": []},
    )
    assert response.status_code in (401, 403)
