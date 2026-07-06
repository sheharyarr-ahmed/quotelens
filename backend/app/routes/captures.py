"""Registers capture metadata. Media itself goes direct from the phone to
Supabase Storage under RLS-scoped paths; no large files transit FastAPI
(SPEC.md - Data flow, auth, and access)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.deps import get_repo

router = APIRouter()


class CaptureIn(BaseModel):
    job_id: str
    kind: Literal["photo", "audio"]
    storage_path: str


@router.post("/captures", status_code=201)
def register_capture(
    capture: CaptureIn,
    user_id: str = Depends(get_current_user_id),
    repo=Depends(get_repo),
) -> dict:
    # Service-role access bypasses RLS: assert the job belongs to the user.
    if repo.get_job(user_id, capture.job_id) is None:
        raise HTTPException(status_code=404, detail="job not found")
    # Storage policies scope uploads to {user_id}/...; registered metadata
    # must point inside the caller's own prefix.
    if not capture.storage_path.startswith(f"{user_id}/"):
        raise HTTPException(status_code=403, detail="storage path not owned")
    return repo.register_capture(
        user_id, capture.job_id, capture.kind, capture.storage_path
    )
