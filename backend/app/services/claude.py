import json
import os

import httpx

from app.pipeline.schemas import TokenUsage


class AnthropicLLM:
    """Claude client for the pipeline's LLM nodes. Model ids come from env
    so deploys can move without a code change."""

    def __init__(self, api_key: str | None = None):
        import anthropic

        self.client = anthropic.Anthropic(
            api_key=api_key or os.environ["ANTHROPIC_API_KEY"]
        )

    @staticmethod
    def _output_config(schema: dict | None) -> dict:
        # Structured outputs make the response guaranteed-parseable JSON;
        # without a schema real models tend to wrap JSON in markdown fences.
        if schema is None:
            return {}
        return {"output_config": {"format": {"type": "json_schema", "schema": schema}}}

    def _parse(self, response) -> tuple[dict, TokenUsage]:
        if response.stop_reason != "end_turn":
            raise ValueError(
                f"LLM response incomplete: stop_reason={response.stop_reason!r}"
            )
        text = "".join(
            block.text for block in response.content if block.type == "text"
        )
        usage = TokenUsage(
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )
        return json.loads(text), usage

    def complete_json(
        self, *, prompt: str, model: str, schema: dict | None = None
    ) -> tuple[dict, TokenUsage]:
        response = self.client.messages.create(
            model=model,
            max_tokens=4096,
            **self._output_config(schema),
            messages=[{"role": "user", "content": prompt}],
        )
        return self._parse(response)

    def analyze_image_json(
        self, *, prompt: str, image_url: str, model: str, schema: dict | None = None
    ) -> tuple[dict, TokenUsage]:
        image_bytes = httpx.get(image_url).content
        import base64

        response = self.client.messages.create(
            model=model,
            max_tokens=2048,
            **self._output_config(schema),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": base64.standard_b64encode(image_bytes).decode(),
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        )
        return self._parse(response)
