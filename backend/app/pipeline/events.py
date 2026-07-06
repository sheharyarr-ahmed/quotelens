"""Pipeline event types and payload builders.

Events persist to quote_events and drive live assembly over Supabase
Realtime; the trace timeline aligns with what the UI showed by construction
(SPEC.md - Realtime and live assembly).
"""

LINE_ITEM_DRAFTED = "line_item_drafted"
RETRY_STARTED = "retry_started"
GENERATION_COMPLETED = "generation_completed"
GENERATION_FAILED = "generation_failed"
QUOTE_ACCEPTED = "quote_accepted"


def line_item_drafted(index: int, item: dict) -> dict:
    return {"index": index, "line_item": item}


def retry_started(attempt: int, errors: list[str]) -> dict:
    return {"attempt": attempt, "errors": errors}


def generation_completed(quote: dict) -> dict:
    return {"quote": quote}


def generation_failed(errors: list[str]) -> dict:
    return {"errors": errors}
