import json

from langgraph.runtime import Runtime

from app import config
from app.pipeline.schemas import WalkthroughTask
from app.pipeline.state import PipelineState
from app.pipeline.tracing import TOKENS_KEY, TRACE_INPUT_KEY, TRACE_OUTPUT_KEY, traced
from app.services.bundle import Services

PROMPT_TEMPLATE = """Extract the discrete work tasks from this job-site
walkthrough narration. Return JSON only:
{{"tasks": [{{"description": str, "quantity": number|null,
  "unit": "sqft"|"linear_ft"|"each"|"flat"|null,
  "source": "stated"|"inferred"}}]}}
Set quantity/unit only when the narration states them ("the room is twelve
by fourteen"); mark source "inferred" for anything you derived rather than
heard.

Narration:
{transcript}"""

# Enforced via structured outputs; mirrors WalkthroughTask.
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "quantity": {"type": ["number", "null"]},
                    "unit": {"enum": ["sqft", "linear_ft", "each", "flat", None]},
                    "source": {"enum": ["stated", "inferred"]},
                },
                "required": ["description", "quantity", "unit", "source"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["tasks"],
    "additionalProperties": False,
}


@traced("parse_walkthrough")
def parse_walkthrough(state: PipelineState, runtime: Runtime[Services]) -> dict:
    prompt = PROMPT_TEMPLATE.format(transcript=state.transcript.text)
    data, usage = runtime.context.llm.complete_json(
        prompt=prompt, model=config.text_model(), schema=RESPONSE_SCHEMA
    )
    tasks = [WalkthroughTask.model_validate(task) for task in data["tasks"]]
    return {
        "parsed_tasks": tasks,
        TOKENS_KEY: usage,
        TRACE_INPUT_KEY: {"transcript": state.transcript.text},
        TRACE_OUTPUT_KEY: {"tasks": json.loads(json.dumps(data["tasks"]))},
    }
