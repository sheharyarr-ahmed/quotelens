from langgraph.runtime import Runtime

from app.pipeline.state import PipelineState
from app.pipeline.tracing import TRACE_INPUT_KEY, TRACE_OUTPUT_KEY, traced
from app.services.bundle import Services


@traced("transcribe")
def transcribe(state: PipelineState, runtime: Runtime[Services]) -> dict:
    audio_url = runtime.context.storage.create_signed_url(state.audio_path)
    transcript = runtime.context.transcription.transcribe(audio_url)
    return {
        "transcript": transcript,
        TRACE_INPUT_KEY: {"audio_path": state.audio_path},
        TRACE_OUTPUT_KEY: {
            "text": transcript.text,
            "duration_seconds": transcript.duration_seconds,
        },
    }
