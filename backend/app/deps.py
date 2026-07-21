"""FastAPI dependency providers; tests swap these via dependency_overrides."""

import os
from functools import lru_cache

from app.db.repo import SupabaseQuoteRepo
from app.services.bundle import Services
from app.services.factory import build_services_from_env


@lru_cache
def _service_client():
    from supabase import create_client

    return create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )


def get_repo() -> SupabaseQuoteRepo:
    return SupabaseQuoteRepo(_service_client())


@lru_cache
def get_services() -> Services:
    """One bundle per process. Without this the Whisper model is rebuilt and
    re-read from disk on every /generate, and N concurrent generations hold N
    copies of the weights - roughly 415MB each for `base`, which OOMs a 1GB
    instance at two concurrent quotes. Tests bypass this via
    dependency_overrides, so the cache never leaks between them."""
    return build_services_from_env()
