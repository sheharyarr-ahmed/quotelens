from langgraph.runtime import Runtime

from app.pipeline import events
from app.pipeline.schemas import Quote, QuoteLineItem
from app.pipeline.state import PipelineState
from app.pipeline.tracing import TRACE_INPUT_KEY, TRACE_OUTPUT_KEY, traced
from app.services.bundle import Services


@traced("compile_quote")
def compile_quote(state: PipelineState, runtime: Runtime[Services]) -> dict:
    # Full Pydantic validation: an uncited line item can not pass this point.
    line_items = [QuoteLineItem.model_validate(item) for item in state.draft_items]
    subtotal = sum(item.total_cents or 0 for item in line_items)
    quote = Quote(
        id=state.quote_id,
        job_id=state.job_id,
        status="completed",
        line_items=line_items,
        subtotal_cents=subtotal,
    )
    runtime.context.quotes.save_completed(quote, state.retry_count)
    runtime.context.events.emit(
        state.quote_id,
        events.GENERATION_COMPLETED,
        events.generation_completed(quote.model_dump()),
    )
    return {
        "quote": quote,
        "status": "completed",
        TRACE_INPUT_KEY: {"item_count": len(line_items)},
        TRACE_OUTPUT_KEY: {"subtotal_cents": subtotal},
    }
