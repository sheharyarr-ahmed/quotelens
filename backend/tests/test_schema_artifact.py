"""The committed JSON Schema artifact must regenerate byte-identical
(SPEC.md - Verification 1). Drift shows up as a red diff; the fix is
`uv run python scripts/export_schema.py` plus a commit."""

from pathlib import Path

from app.pipeline.schemas import quote_schema_json

ARTIFACT = Path(__file__).resolve().parents[2] / "schema" / "quote.schema.json"


def test_artifact_in_sync():
    assert ARTIFACT.read_text(encoding="utf-8") == quote_schema_json()
