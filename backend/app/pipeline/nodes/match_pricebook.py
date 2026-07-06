"""Single Haiku call with the full active price book in context; output is
constrained to an existing price_book_item_id or null per task, so the
no-invented-prices rule stays mechanical (SPEC.md - Pipeline)."""

import json

from langgraph.runtime import Runtime

from app import config
from app.pipeline.schemas import PriceBookMatch
from app.pipeline.state import PipelineState
from app.pipeline.tracing import TOKENS_KEY, TRACE_INPUT_KEY, TRACE_OUTPUT_KEY, traced
from app.services.bundle import Services

PROMPT_TEMPLATE = """Match each task to at most one price book item.
Return JSON only:
{{"matches": [{{"task_index": int, "price_book_item_id": str|null}}]}}
Use null when no item fits; never guess.

Price book:
{price_book}

Tasks:
{tasks}"""


@traced("match_pricebook")
def match_pricebook(state: PipelineState, runtime: Runtime[Services]) -> dict:
    prompt = PROMPT_TEMPLATE.format(
        price_book=json.dumps([i.model_dump() for i in state.price_book_items]),
        tasks=json.dumps([t.model_dump() for t in state.parsed_tasks]),
    )
    data, usage = runtime.context.llm.complete_json(
        prompt=prompt, model=config.text_model()
    )
    known_ids = {item.id for item in state.price_book_items}
    matches = []
    for raw in data["matches"]:
        item_id = raw.get("price_book_item_id")
        # Mechanical guard: an id absent from the book is treated as no
        # match (renders `unpriced`), never as a price to invent.
        if item_id is not None and item_id not in known_ids:
            item_id = None
        matches.append(
            PriceBookMatch(task_index=raw["task_index"], price_book_item_id=item_id)
        )
    return {
        "matches": matches,
        TOKENS_KEY: usage,
        TRACE_INPUT_KEY: {"task_count": len(state.parsed_tasks)},
        TRACE_OUTPUT_KEY: {"matches": [m.model_dump() for m in matches]},
    }
