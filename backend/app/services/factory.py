import os

from app.services.bundle import Services
from app.services.claude import AnthropicLLM
from app.services.quote_store import SupabaseQuoteStore
from app.services.sinks import SupabaseEventSink, SupabaseTraceWriter
from app.services.storage import SupabaseStorage
from app.services.transcription import FasterWhisperTranscription


def build_services_from_env() -> Services:
    from supabase import create_client

    client = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    return Services(
        transcription=FasterWhisperTranscription(),
        llm=AnthropicLLM(),
        storage=SupabaseStorage(client),
        events=SupabaseEventSink(client),
        traces=SupabaseTraceWriter(client),
        quotes=SupabaseQuoteStore(client),
    )
