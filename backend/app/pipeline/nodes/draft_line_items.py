"""Drafts line items from parsed tasks, price book matches, and photo
observations. Prices are set mechanically from the matched book item, never
by the model. Emits one line_item_drafted event per item, in order, which
drives live assembly on the review screen."""

import json

from langgraph.runtime import Runtime

from app import config
from app.pipeline import events
from app.pipeline.state import PipelineState
from app.pipeline.tracing import TOKENS_KEY, TRACE_INPUT_KEY, TRACE_OUTPUT_KEY, traced
from app.services.bundle import Services

PROMPT_TEMPLATE = """Draft quote line items for these tasks.
Return JSON only:
{{"line_items": [{{"description": str, "quantity": number,
  "unit": "sqft"|"linear_ft"|"each"|"flat",
  "price_book_item_id": str|null,
  "photo_citations": [photo_id, ..],
  "confidence": "stated"|"inferred"}}]}}
Rules:
- Every line item MUST cite at least one photo_id from the observations.
- Only cite photo_ids present in the observations below.
- Take quantity from the narration when stated; otherwise estimate from the
  observation dimensions and mark confidence "inferred".
- Keep the price_book_item_id assigned by the matches; do not invent ids.

Tasks:
{tasks}

Matches:
{matches}

Photo observations:
{observations}
{feedback}"""

RETRY_FEEDBACK_TEMPLATE = """
Your previous draft failed validation. Fix these errors and redraft all
line items:
{errors}"""


@traced("draft_line_items")
def draft_line_items(state: PipelineState, runtime: Runtime[Services]) -> dict:
    feedback = ""
    if state.validation_errors:
        feedback = RETRY_FEEDBACK_TEMPLATE.format(
            errors=json.dumps(state.validation_errors)
        )
    prompt = PROMPT_TEMPLATE.format(
        tasks=json.dumps([t.model_dump() for t in state.parsed_tasks]),
        matches=json.dumps([m.model_dump() for m in state.matches]),
        observations=json.dumps([o.model_dump() for o in state.observations]),
        feedback=feedback,
    )
    data, usage = runtime.context.llm.complete_json(
        prompt=prompt, model=config.text_model()
    )

    book_by_id = {item.id: item for item in state.price_book_items}
    draft_items: list[dict] = []
    for index, raw in enumerate(data["line_items"]):
        item = dict(raw)
        book_item = book_by_id.get(item.get("price_book_item_id"))
        if book_item is not None:
            # Price comes from the book, mechanically; quantity may still be
            # model-estimated (and flagged inferred). Coerce like Pydantic's
            # lax mode does downstream, so a numeric-string quantity ("336")
            # cannot pass validation while leaving total_cents unset.
            item["unit_price_cents"] = book_item.unit_price_cents
            try:
                quantity = float(item.get("quantity"))
            except (TypeError, ValueError):
                quantity = None
            if quantity is not None:
                item["total_cents"] = round(quantity * book_item.unit_price_cents)
        else:
            item["price_book_item_id"] = None
            item["unit_price_cents"] = None  # renders as `unpriced`
            item["total_cents"] = None
        draft_items.append(item)
        runtime.context.events.emit(
            state.quote_id,
            events.LINE_ITEM_DRAFTED,
            events.line_item_drafted(index, item),
        )

    return {
        "draft_items": draft_items,
        TOKENS_KEY: usage,
        TRACE_INPUT_KEY: {
            "task_count": len(state.parsed_tasks),
            "retry": bool(state.validation_errors),
            "validation_errors": state.validation_errors,
        },
        TRACE_OUTPUT_KEY: {"line_items": draft_items},
    }
