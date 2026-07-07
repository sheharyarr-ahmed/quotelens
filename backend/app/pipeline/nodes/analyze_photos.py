"""Dedicated vision node: one Claude Sonnet call per photo, producing
structured observations tagged with photo ids. draft_line_items may only
cite ids present in this observation set, which makes citations mechanically
checkable and keeps retries from re-paying vision (SPEC.md - Pipeline)."""

from concurrent.futures import ThreadPoolExecutor

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

# Enforced via structured outputs; mirrors PhotoObservation minus photo_id,
# which this node stamps mechanically from the capture, never the model.
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "surfaces": {"type": "array", "items": {"type": "string"}},
        "damage": {"type": "array", "items": {"type": "string"}},
        "room": {"type": ["string", "null"]},
        "dimensions_estimate": {"type": ["string", "null"]},
        "notes": {"type": ["string", "null"]},
    },
    "required": ["surfaces", "damage", "room", "dimensions_estimate", "notes"],
    "additionalProperties": False,
}


@traced("analyze_photos")
def analyze_photos(state: PipelineState, runtime: Runtime[Services]) -> dict:
    def analyze_one(photo) -> tuple[PhotoObservation, TokenUsage]:
        url = runtime.context.storage.create_signed_url(photo.storage_path)
        data, usage = runtime.context.llm.analyze_image_json(
            prompt=PROMPT,
            image_url=url,
            model=config.vision_model(),
            schema=RESPONSE_SCHEMA,
        )
        return PhotoObservation(photo_id=photo.photo_id, **data), usage

    # One vision call per photo, in parallel (SPEC.md - Pipeline); map keeps
    # the observation order aligned with the capture order.
    with ThreadPoolExecutor(max_workers=min(4, max(1, len(state.photos)))) as pool:
        analyzed = list(pool.map(analyze_one, state.photos))

    observations = [observation for observation, _ in analyzed]
    total_in = sum(usage.input_tokens for _, usage in analyzed)
    total_out = sum(usage.output_tokens for _, usage in analyzed)
    return {
        "observations": observations,
        TOKENS_KEY: TokenUsage(input_tokens=total_in, output_tokens=total_out),
        TRACE_INPUT_KEY: {"photo_ids": [p.photo_id for p in state.photos]},
        TRACE_OUTPUT_KEY: {"observations": [o.model_dump() for o in observations]},
    }
