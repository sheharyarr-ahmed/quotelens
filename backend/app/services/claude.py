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

    def _parse(self, response) -> tuple[dict, TokenUsage]:
        text = "".join(
            block.text for block in response.content if block.type == "text"
        )
        usage = TokenUsage(
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )
        return json.loads(text), usage

    def complete_json(self, *, prompt: str, model: str) -> tuple[dict, TokenUsage]:
        response = self.client.messages.create(
            model=model,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        return self._parse(response)

    def analyze_image_json(
        self, *, prompt: str, image_url: str, model: str
    ) -> tuple[dict, TokenUsage]:
        image_bytes = httpx.get(image_url).content
        import base64

        response = self.client.messages.create(
            model=model,
            max_tokens=2048,
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
