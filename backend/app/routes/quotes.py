from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.auth import get_current_user_id
from app.deps import get_repo, get_services
from app.routes.generate import run_pipeline
from app.pipeline.state import PipelineState
from app.services.bundle import Services

router = APIRouter()


@router.get("/quotes/{quote_id}")
def get_quote(
    quote_id: str,
    user_id: str = Depends(get_current_user_id),
    repo=Depends(get_repo),
) -> dict:
    quote = repo.get_quote(user_id, quote_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="quote not found")
    return quote


@router.post("/quotes/{quote_id}/regenerate", status_code=202)
def regenerate(
    quote_id: str,
    background: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
    repo=Depends(get_repo),
    services: Services = Depends(get_services),
) -> dict:
    """Re-runs the pipeline from the cached transcript and photo
    observations (rebuilt from agent_traces), so a regenerate never re-pays
    transcription or vision (SPEC.md - Pipeline)."""
    quote = repo.get_quote(user_id, quote_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="quote not found")
    # Only settled outcomes may re-run: regenerating an 'accepted' quote
    # would silently erase the client's recorded agreement, 'generating'
    # would race two pipelines onto one quote, and 'sent' is already in the
    # client's hands.
    if quote["status"] not in ("completed", "failed"):
        raise HTTPException(
            status_code=409,
            detail=f"cannot regenerate a {quote['status']} quote",
        )
    transcript, observations = repo.cached_pipeline_context(quote_id)
    if transcript is None or observations is None:
        raise HTTPException(
            status_code=409, detail="no cached pipeline context to regenerate from"
        )
    state = PipelineState(
        job_id=quote["job_id"],
        quote_id=quote_id,
        price_book_items=repo.get_active_price_book_items(user_id),
        transcript=transcript,
        observations=observations,
    )
    # Before scheduling: the status flip is the realtime signal that resets
    # every open review screen into the stage ticker for the re-run.
    repo.mark_generating(user_id, quote_id)
    background.add_task(run_pipeline, state, services)
    return {"quote_id": quote_id}
