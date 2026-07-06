"""Regenerate schema/quote.schema.json from the Pydantic quote models.

Run after any intentional quote model change, then commit the diff:
    cd backend && uv run python scripts/export_schema.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.pipeline.schemas import quote_schema_json  # noqa: E402

ARTIFACT = Path(__file__).resolve().parents[2] / "schema" / "quote.schema.json"


def main() -> None:
    ARTIFACT.write_text(quote_schema_json(), encoding="utf-8", newline="\n")
    print(f"wrote {ARTIFACT}")


if __name__ == "__main__":
    main()
