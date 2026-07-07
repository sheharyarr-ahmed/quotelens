"""In-memory fakes for the Services bundle. No network, no keys."""

from app.pipeline.schemas import TokenUsage, Transcript

FAKE_USAGE = TokenUsage(input_tokens=100, output_tokens=50)


class FakeTranscription:
    def __init__(self, transcript: Transcript | None = None):
        self.transcript = transcript or Transcript(
            text="Water damage on the ceiling and the wall behind the door. "
            "The room is twelve by fourteen. Two coats on all walls, "
            "prime the stained ceiling first.",
            duration_seconds=45.0,
        )
        self.calls = 0

    def transcribe(self, audio_path: str) -> Transcript:
        self.calls += 1
        return self.transcript


class FakeLLM:
    """Scripted LLM: complete_json pops responses FIFO; vision responses are
    keyed separately so parallel analyze_photos calls stay order-independent."""

    def __init__(
        self,
        responses: list[dict] | None = None,
        vision_responses: dict[str, dict] | None = None,
    ):
        self.responses = list(responses or [])
        self.vision_responses = dict(vision_responses or {})
        self.completion_calls: list[dict] = []
        self.vision_calls: list[dict] = []

    def complete_json(
        self, *, prompt: str, model: str, schema: dict | None = None
    ) -> tuple[dict, TokenUsage]:
        self.completion_calls.append(
            {"prompt": prompt, "model": model, "schema": schema}
        )
        if not self.responses:
            raise AssertionError("FakeLLM ran out of scripted responses")
        return self.responses.pop(0), FAKE_USAGE

    def analyze_image_json(
        self, *, prompt: str, image_url: str, model: str, schema: dict | None = None
    ) -> tuple[dict, TokenUsage]:
        self.vision_calls.append(
            {"prompt": prompt, "image_url": image_url, "model": model,
             "schema": schema}
        )
        if image_url not in self.vision_responses:
            raise AssertionError(f"FakeLLM has no vision response for {image_url}")
        return self.vision_responses[image_url], FAKE_USAGE


class FakeStorage:
    def __init__(self):
        self.signed: list[str] = []

    def create_signed_url(self, path: str, expires_in: int = 3600) -> str:
        self.signed.append(path)
        return f"https://fake.storage/signed/{path}"


class InMemoryEventSink:
    def __init__(self):
        self.events: list[tuple[str, str, dict]] = []

    def emit(self, quote_id: str, event_type: str, payload: dict) -> None:
        self.events.append((quote_id, event_type, payload))

    def types(self) -> list[str]:
        return [event_type for _, event_type, _ in self.events]


class InMemoryQuoteStore:
    def __init__(self):
        self.completed: list[tuple] = []  # (quote, retry_count)
        self.failed: list[tuple] = []  # (quote_id, errors, retry_count)

    def save_completed(self, quote, retry_count) -> None:
        self.completed.append((quote, retry_count))

    def mark_failed(self, quote_id, errors, retry_count) -> None:
        self.failed.append((quote_id, errors, retry_count))


class InMemoryTraceWriter:
    def __init__(self):
        self.records: list[dict] = []

    def record(self, quote_id, node, input, output, duration_ms, tokens) -> None:
        self.records.append(
            {
                "quote_id": quote_id,
                "node": node,
                "input": input,
                "output": output,
                "duration_ms": duration_ms,
                "tokens": tokens,
            }
        )

    def nodes(self) -> list[str]:
        return [r["node"] for r in self.records]
