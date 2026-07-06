"""Dedicated vision node: one Claude Sonnet call per photo, producing
structured observations tagged with photo ids. draft_line_items may only
cite ids present in this observation set, which makes citations mechanically
checkable and keeps retries from re-paying vision (SPEC.md - Pipeline)."""

from langgraph.runtime import Runtime

from app import config
from app.pipeline.schemas import PhotoObservation, TokenUsage
from app.pipeline.state import PipelineState
from app.pipeline.tracing import TOKENS_KEY, TRACE_INPUT_KEY, TRACE_OUTPUT_KEY, traced
from app.services.bundle import Services

PROMPT = """You are surveying a job site photo for a trade estimate.
Return JSON only, with this shape:
{"surfaces": [..], "damage": [..], "room": str|null,
 "dimensions_estimate": str|null, "notes": str|null}
List visible surfaces (walls, ceiling, trim, floor), visible damage
(water stain, mold, cracked drywall), the room type if recognizable, and a
rough dimension estimate only if the photo supports one."""


@traced("analyze_photos")
def analyze_photos(state: PipelineState, runtime: Runtime[Services]) -> dict:
    observations: list[PhotoObservation] = []
    total_in = total_out = 0
    for photo in state.photos:
        url = runtime.context.storage.create_signed_url(photo.storage_path)
        data, usage = runtime.context.llm.analyze_image_json(
            prompt=PROMPT, image_url=url, model=config.vision_model()
        )
        observations.append(PhotoObservation(photo_id=photo.photo_id, **data))
        total_in += usage.input_tokens
        total_out += usage.output_tokens
    return {
        "observations": observations,
        TOKENS_KEY: TokenUsage(input_tokens=total_in, output_tokens=total_out),
        TRACE_INPUT_KEY: {"photo_ids": [p.photo_id for p in state.photos]},
        TRACE_OUTPUT_KEY: {"observations": [o.model_dump() for o in observations]},
    }
