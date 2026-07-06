"""Pure-code validation node: no LLM. Parses each draft item against the
QuoteLineItem schema (which enforces non-empty photo_citations) and
cross-checks every citation against the analyze_photos observation set, so
citations are mechanically checkable instead of self-reported
(SPEC.md - Quote schema and integrity)."""

from langgraph.runtime import Runtime
from pydantic import ValidationError

from app.pipeline import events
from app.pipeline.schemas import QuoteLineItem
from app.pipeline.state import PipelineState
from app.pipeline.tracing import TRACE_INPUT_KEY, TRACE_OUTPUT_KEY, traced
from app.services.bundle import Services

MAX_RETRIES = 2  # hardcoded per SPEC.md - Pipeline


@traced("validate")
def validate(state: PipelineState, runtime: Runtime[Services]) -> dict:
    observed_ids = {o.photo_id for o in state.observations}
    errors: list[str] = []

    # A degenerate empty draft must not sail through as a completed empty
    # quote; it is a validation failure like any other.
    if not state.draft_items:
        errors.append("draft contains no line items")

    for index, item in enumerate(state.draft_items):
        try:
            parsed = QuoteLineItem.model_validate(item)
        except ValidationError as exc:
            for err in exc.errors():
                location = ".".join(str(part) for part in err["loc"])
                errors.append(f"line_items[{index}].{location}: {err['msg']}")
            continue
        for citation in parsed.photo_citations:
            if citation not in observed_ids:
                errors.append(
                    f"line_items[{index}]: citation {citation!r} does not "
                    "refer to an analyzed photo"
                )

    update: dict = {
        "validation_errors": errors,
        TRACE_INPUT_KEY: {
            "item_count": len(state.draft_items),
            "retry_count": state.retry_count,
        },
        TRACE_OUTPUT_KEY: {"errors": errors},
    }
    if not errors:
        return update

    if state.retry_count < MAX_RETRIES:
        attempt = state.retry_count + 1
        update["retry_count"] = attempt
        runtime.context.events.emit(
            state.quote_id,
            events.RETRY_STARTED,
            events.retry_started(attempt, errors),
        )
    else:
        # Cap exhausted: keep the last draft visible in a failed state;
        # regenerate re-runs from cached transcript and observations.
        update["status"] = "failed"
        runtime.context.quotes.mark_failed(
            state.quote_id, errors, state.retry_count
        )
        runtime.context.events.emit(
            state.quote_id,
            events.GENERATION_FAILED,
            events.generation_failed(errors),
        )
    return update
