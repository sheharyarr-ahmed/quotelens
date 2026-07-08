"""Regenerate route contract: the quote must flip back to 'generating'
BEFORE the background re-run is scheduled — the quotes UPDATE riding
realtime is what drops every open review screen back into the stage ticker
(SPEC.md - Mobile UI/UX - failed state). The live harness caught the
original gap: without the flip, no device ever learns a re-run started."""

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.pipeline.schemas import PhotoObservation, Transcript
from app.routes.quotes import regenerate


class FakeRegenRepo:
    def __init__(self, cached=True):
        self.cached = cached
        self.marked: list[tuple[str, str]] = []
        self.tasks_when_marked: int | None = None
        self._bg: BackgroundTasks | None = None

    def get_quote(self, user_id, quote_id):
        return {"id": quote_id, "job_id": "job-1", "user_id": user_id}

    def cached_pipeline_context(self, quote_id):
        if not self.cached:
            return None, None
        return Transcript(text="cached"), [PhotoObservation(photo_id="photo-1")]

    def get_active_price_book_items(self, user_id):
        return []

    def mark_generating(self, user_id, quote_id):
        self.marked.append((user_id, quote_id))
        if self._bg is not None:
            self.tasks_when_marked = len(self._bg.tasks)


def test_regenerate_marks_generating_before_scheduling():
    repo = FakeRegenRepo()
    background = BackgroundTasks()
    repo._bg = background
    result = regenerate(
        "q1", background, user_id="u1", repo=repo, services=object()
    )
    assert result == {"quote_id": "q1"}
    assert repo.marked == [("u1", "q1")]
    assert repo.tasks_when_marked == 0  # flipped before add_task
    assert len(background.tasks) == 1


def test_regenerate_409_without_cache_leaves_status_alone():
    repo = FakeRegenRepo(cached=False)
    background = BackgroundTasks()
    with pytest.raises(HTTPException) as exc:
        regenerate("q1", background, user_id="u1", repo=repo, services=object())
    assert exc.value.status_code == 409
    assert repo.marked == []
    assert background.tasks == []
