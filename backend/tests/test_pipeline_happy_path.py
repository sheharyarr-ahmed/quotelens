from app.pipeline import events
from app.pipeline.graph import graph
from tests.conftest import initial_state

ALL_NODES = [
    "transcribe",
    "analyze_photos",
    "parse_walkthrough",
    "match_pricebook",
    "draft_line_items",
    "validate",
    "compile_quote",
]

LLM_NODES = {
    "analyze_photos",
    "parse_walkthrough",
    "match_pricebook",
    "draft_line_items",
}


def test_happy_path_completes(happy_services):
    result = graph.invoke(initial_state(), context=happy_services)

    assert result["status"] == "completed"
    quote = result["quote"]
    assert quote.status == "completed"
    assert len(quote.line_items) == 2
    assert all(item.photo_citations for item in quote.line_items)
    # Prices come from the book mechanically: 336 * 180 + 168 * 95.
    assert quote.subtotal_cents == 336 * 180 + 168 * 95
    assert quote.line_items[1].confidence == "inferred"


def test_happy_path_traces_all_seven_nodes(happy_services):
    graph.invoke(initial_state(), context=happy_services)

    nodes = happy_services.traces.nodes()
    assert sorted(nodes) == sorted(ALL_NODES)
    for record in happy_services.traces.records:
        assert record["duration_ms"] >= 0
        if record["node"] in LLM_NODES:
            assert record["tokens"] is not None
            assert record["tokens"].output_tokens > 0


def test_happy_path_event_sequence(happy_services):
    graph.invoke(initial_state(), context=happy_services)

    assert happy_services.events.types() == [
        events.LINE_ITEM_DRAFTED,
        events.LINE_ITEM_DRAFTED,
        events.GENERATION_COMPLETED,
    ]
    drafted = [
        payload
        for _, event_type, payload in happy_services.events.events
        if event_type == events.LINE_ITEM_DRAFTED
    ]
    assert [payload["index"] for payload in drafted] == [0, 1]
