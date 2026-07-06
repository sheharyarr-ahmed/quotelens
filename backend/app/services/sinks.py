"""Durable sinks: pipeline events and agent traces land in Postgres, where
Realtime (quote_events) and the trace screen (agent_traces) read them."""

from app.pipeline.schemas import TokenUsage


class SupabaseEventSink:
    def __init__(self, client):
        self.client = client

    def emit(self, quote_id: str, event_type: str, payload: dict) -> None:
        self.client.table("quote_events").insert(
            {"quote_id": quote_id, "event_type": event_type, "payload": payload}
        ).execute()


class SupabaseTraceWriter:
    def __init__(self, client):
        self.client = client

    def record(
        self,
        quote_id: str,
        node: str,
        input: dict,
        output: dict,
        duration_ms: int,
        tokens: TokenUsage | None,
    ) -> None:
        row = {
            "quote_id": quote_id,
            "node": node,
            "input": input,
            "output": output,
            "duration_ms": duration_ms,
        }
        if tokens is not None:
            row["input_tokens"] = tokens.input_tokens
            row["output_tokens"] = tokens.output_tokens
        self.client.table("agent_traces").insert(row).execute()
