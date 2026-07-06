"""Every node writes to agent_traces (SPEC.md - Pipeline): the decorator
times the node body and forwards trace metadata the node stashes in its
state update under private keys, which are stripped before LangGraph sees
the update."""

import functools
import time

from langgraph.runtime import Runtime

from app.pipeline.state import PipelineState
from app.services.bundle import Services

TOKENS_KEY = "_tokens"
TRACE_INPUT_KEY = "_trace_input"
TRACE_OUTPUT_KEY = "_trace_output"


def traced(node_name: str):
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(state: PipelineState, runtime: Runtime[Services]) -> dict:
            start = time.perf_counter()
            update = fn(state, runtime)
            duration_ms = int((time.perf_counter() - start) * 1000)
            tokens = update.pop(TOKENS_KEY, None)
            trace_input = update.pop(TRACE_INPUT_KEY, {})
            trace_output = update.pop(TRACE_OUTPUT_KEY, {})
            runtime.context.traces.record(
                state.quote_id,
                node_name,
                trace_input,
                trace_output,
                duration_ms,
                tokens,
            )
            return update

        return wrapper

    return decorator
