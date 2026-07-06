"""Fire-and-forget generation: the mobile app subscribes to Realtime after
triggering this endpoint; live assembly makes polling unnecessary
(SPEC.md - Data flow, auth, and access)."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.deps import get_repo, get_services
from app.pipeline import events
from app.pipeline.graph import graph
from app.pipeline.schemas import PhotoRef
from app.pipeline.state import PipelineState
from app.services.bundle import Services

router = APIRouter()


class GenerateIn(BaseModel):
    job_id: str
    audio_path: str
    photos: list[PhotoRef]


def run_pipeline(state: PipelineState, services: Services) -> None:
    try:
        graph.invoke(state, context=services)
    except Exception as exc:
        # Infrastructure failures (malformed LLM output, network, storage)
        # must not strand the quote in `generating` with a Realtime
        # subscriber waiting forever; surface them like a validation failure.
        # retry_count=None: the crashed run's true count is unknowable here
        # (graph state is gone), so the column is left untouched rather than
        # misreported; the event and traces carry the real story.
        services.quotes.mark_failed(state.quote_id, [str(exc)], None)
        services.events.emit(
            state.quote_id,
            events.GENERATION_FAILED,
            events.generation_failed([f"pipeline error: {exc}"]),
        )


@router.post("/generate", status_code=202)
def generate(
    body: GenerateIn,
    background: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
    repo=Depends(get_repo),
    services: Services = Depends(get_services),
) -> dict:
    # Service-role access bypasses RLS, so cross-tenant ownership is
    # asserted here: the job must belong to the verified user.
    if repo.get_job(user_id, body.job_id) is None:
        raise HTTPException(status_code=404, detail="job not found")
    # Storage paths are client-supplied and later signed via service role;
    # without this prefix check a user could feed another tenant's media
    # into their own pipeline and read it back through transcript and
    # observations. Upload paths are RLS-scoped to {user_id}/... by the
    # storage policies.
    paths = [body.audio_path] + [photo.storage_path for photo in body.photos]
    if not all(path.startswith(f"{user_id}/") for path in paths):
        raise HTTPException(status_code=403, detail="storage path not owned")
    quote = repo.create_quote(user_id, body.job_id)
    state = PipelineState(
        job_id=body.job_id,
        quote_id=quote["id"],
        audio_path=body.audio_path,
        photos=body.photos,
        price_book_items=repo.get_active_price_book_items(user_id),
    )
    background.add_task(run_pipeline, state, services)
    return {"quote_id": quote["id"]}
