"""Pipeline wiring: seven nodes, parallel entry fan-out, one bounded retry
edge (SPEC.md - Pipeline).

    START ─┬─ transcribe ──────┐
           └─ analyze_photos ──┴─ parse_walkthrough ─ match_pricebook
                                                          │
                 compile_quote ── validate ── draft_line_items
                      │              │ ▲ (retry while retry_count < 2)
                     END             └─── END on cap exhaustion (failed)

On regenerate, transcript and observations arrive cached in the initial
state and the entry router goes straight to parse_walkthrough, so a
regenerate never re-pays transcription or vision.
"""

from langgraph.graph import END, START, StateGraph

from app.pipeline.nodes.analyze_photos import analyze_photos
from app.pipeline.nodes.compile_quote import compile_quote
from app.pipeline.nodes.draft_line_items import draft_line_items
from app.pipeline.nodes.match_pricebook import match_pricebook
from app.pipeline.nodes.parse_walkthrough import parse_walkthrough
from app.pipeline.nodes.transcribe import transcribe
from app.pipeline.nodes.validate import validate
from app.pipeline.state import PipelineState
from app.services.bundle import Services


def route_entry(state: PipelineState) -> list[str] | str:
    if state.transcript is not None and state.observations is not None:
        return "parse_walkthrough"
    return ["transcribe", "analyze_photos"]


def route_after_validate(state: PipelineState) -> str:
    if not state.validation_errors:
        return "compile_quote"
    if state.status == "failed":
        return END
    return "draft_line_items"


def build_graph():
    builder = StateGraph(PipelineState, context_schema=Services)
    builder.add_node("transcribe", transcribe)
    builder.add_node("analyze_photos", analyze_photos)
    builder.add_node("parse_walkthrough", parse_walkthrough)
    builder.add_node("match_pricebook", match_pricebook)
    builder.add_node("draft_line_items", draft_line_items)
    builder.add_node("validate", validate)
    builder.add_node("compile_quote", compile_quote)

    builder.add_conditional_edges(
        START, route_entry, ["transcribe", "analyze_photos", "parse_walkthrough"]
    )
    # Join: parse_walkthrough waits for both parallel branches.
    builder.add_edge(["transcribe", "analyze_photos"], "parse_walkthrough")
    builder.add_edge("parse_walkthrough", "match_pricebook")
    builder.add_edge("match_pricebook", "draft_line_items")
    builder.add_edge("draft_line_items", "validate")
    builder.add_conditional_edges(
        "validate", route_after_validate, ["compile_quote", "draft_line_items", END]
    )
    builder.add_edge("compile_quote", END)
    return builder.compile()


graph = build_graph()
