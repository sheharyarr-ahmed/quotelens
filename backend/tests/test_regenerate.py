from app.pipeline.graph import graph
from tests.conftest import (
    CACHED_OBSERVATIONS,
    CACHED_TRANSCRIPT,
    GOOD_DRAFT_RESPONSE,
    MATCH_RESPONSE,
    PARSE_RESPONSE,
    build_services,
    initial_state,
)


def test_skips_transcribe_and_vision():
    """Regenerate reuses the cached transcript and photo observations
    without re-running transcribe or analyze_photos
    (SPEC.md - Verification 1). Also pins the graph subtlety that the
    parse_walkthrough join edge does not block direct entry routing."""
    services = build_services([PARSE_RESPONSE, MATCH_RESPONSE, GOOD_DRAFT_RESPONSE])
    state = initial_state(
        transcript=CACHED_TRANSCRIPT, observations=CACHED_OBSERVATIONS
    )
    result = graph.invoke(state, context=services)

    assert result["status"] == "completed"
    assert services.transcription.calls == 0
    assert services.llm.vision_calls == []
    nodes = services.traces.nodes()
    assert "transcribe" not in nodes
    assert "analyze_photos" not in nodes
    assert nodes[0] == "parse_walkthrough"
