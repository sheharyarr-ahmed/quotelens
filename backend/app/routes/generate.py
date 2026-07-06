"""Fire-and-forget generation: the mobile app subscribes to Realtime after
triggering this endpoint; live assembly makes polling unnecessary
(SPEC.md - Data flow, auth, and access)."""

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.deps import get_repo, get_services
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
    graph.invoke(state, context=services)


@router.post("/generate", status_code=202)
def generate(
    body: GenerateIn,
    background: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
    repo=Depends(get_repo),
    services: Services = Depends(get_services),
) -> dict:
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
