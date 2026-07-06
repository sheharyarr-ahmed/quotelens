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


def get_services() -> Services:
    return build_services_from_env()
