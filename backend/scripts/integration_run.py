"""First real end-to-end pipeline run against live services.

Anthropic vision + text, faster-whisper transcription, hosted Supabase.
Mirrors the production entry (app/routes/generate.py) but drives the graph
directly so evidence and invariant checks live in one place. NOT collected
by pytest — this spends real tokens and writes to the live DB.

Run from backend/:
    set -a && source ../.env && set +a && uv run python scripts/integration_run.py

Setup is idempotent: fixed test user + one reused job per user; media is
upserted to the same storage paths. Each run creates a fresh quote.
"""

import json
import os
import pathlib
import sys
import time

FIXTURES = pathlib.Path(__file__).parent.parent / "tests" / "fixtures"
TEST_EMAIL = "integration-test@quotelens.dev"
JOB_MARKER = "Integration Test Client"

PHOTOS = [  # (photo_id, fixture filename)
    ("photo-water-stain", "photo-water-stain.jpg"),
    ("photo-scuffed-wall", "photo-scuffed-wall.jpg"),
]
AUDIO_FIXTURE = "voice-note.wav"

REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]


def _load_env() -> None:
    """Fallback .env parse so the script also works without `source ../.env`."""
    env_file = pathlib.Path(__file__).parent.parent.parent / ".env"
    if all(os.environ.get(k) for k in REQUIRED_ENV) or not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _ensure_user(client) -> str:
    users = client.auth.admin.list_users()
    for user in users:
        if user.email == TEST_EMAIL:
            return user.id
    created = client.auth.admin.create_user(
        {"email": TEST_EMAIL, "email_confirm": True, "password": os.urandom(16).hex()}
    )
    return created.user.id


def _ensure_job(client, user_id: str) -> str:
    rows = (
        client.table("jobs")
        .select("id")
        .eq("user_id", user_id)
        .eq("client_name", JOB_MARKER)
        .execute()
    )
    if rows.data:
        return rows.data[0]["id"]
    inserted = (
        client.table("jobs")
        .insert(
            {
                "user_id": user_id,
                "client_name": JOB_MARKER,
                "address": "12 Demo Street",
                "trade": "painting",
            }
        )
        .execute()
    )
    return inserted.data[0]["id"]


def _upload_media(client, user_id: str, job_id: str) -> tuple[str, list]:
    from app.pipeline.schemas import PhotoRef

    bucket = client.storage.from_("captures")
    uploads = [(AUDIO_FIXTURE, "audio/wav")] + [(f, "image/jpeg") for _, f in PHOTOS]
    for filename, content_type in uploads:
        path = f"{user_id}/{job_id}/{filename}"
        bucket.upload(
            path,
            (FIXTURES / filename).read_bytes(),
            {"content-type": content_type, "upsert": "true"},
        )
    audio_path = f"{user_id}/{job_id}/{AUDIO_FIXTURE}"
    photo_refs = [
        PhotoRef(photo_id=pid, storage_path=f"{user_id}/{job_id}/{fname}")
        for pid, fname in PHOTOS
    ]
    # captures rows, skipping ones already registered on a previous run
    existing = {
        row["storage_path"]
        for row in client.table("captures")
        .select("storage_path")
        .eq("job_id", job_id)
        .execute()
        .data
    }
    for kind, path in [("audio", audio_path)] + [
        ("photo", ref.storage_path) for ref in photo_refs
    ]:
        if path not in existing:
            client.table("captures").insert(
                {"user_id": user_id, "job_id": job_id, "kind": kind,
                 "storage_path": path}
            ).execute()
    return audio_path, photo_refs


def _print_header(title: str) -> None:
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def _dump(rows, *, truncate: int = 400) -> None:
    for row in rows:
        text = json.dumps(row, default=str)
        print(text[:truncate] + ("…" if len(text) > truncate else ""))


def main() -> int:
    _load_env()
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        print(f"missing env vars: {missing}", file=sys.stderr)
        return 2

    from supabase import create_client

    from app.db.repo import SupabaseQuoteRepo
    from app.pipeline.graph import graph
    from app.pipeline.state import PipelineState
    from app.services.factory import build_services_from_env

    client = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    _print_header("SETUP (idempotent)")
    user_id = _ensure_user(client)
    job_id = _ensure_job(client, user_id)
    audio_path, photo_refs = _upload_media(client, user_id, job_id)
    print(f"user_id={user_id}\njob_id={job_id}\naudio={audio_path}")
    for ref in photo_refs:
        print(f"photo {ref.photo_id} -> {ref.storage_path}")

    repo = SupabaseQuoteRepo(client)
    price_book_items = repo.get_active_price_book_items(user_id)
    print(f"price book items loaded: {len(price_book_items)}")

    quote_row = repo.create_quote(user_id, job_id)
    quote_id = quote_row["id"]
    print(f"quote_id={quote_id}")

    state = PipelineState(
        job_id=job_id,
        quote_id=quote_id,
        audio_path=audio_path,
        photos=photo_refs,
        price_book_items=price_book_items,
    )

    _print_header("PIPELINE RUN (real services)")
    started = time.monotonic()
    result = graph.invoke(state, context=build_services_from_env())
    elapsed = time.monotonic() - started
    print(f"graph.invoke finished in {elapsed:.1f}s, status={result['status']}")

    _print_header("EVIDENCE: agent_traces (node, ms, tokens)")
    traces = (
        client.table("agent_traces")
        .select("node, duration_ms, input_tokens, output_tokens, output")
        .eq("quote_id", quote_id)
        .order("created_at")
        .execute()
        .data
    )
    for t in traces:
        print(
            f"{t['node']:<18} {t['duration_ms']:>7}ms  "
            f"in={t['input_tokens'] or 0:<6} out={t['output_tokens'] or 0}"
        )

    _print_header("EVIDENCE: model outputs (from traces)")
    for t in traces:
        if t["node"] in ("transcribe", "analyze_photos", "parse_walkthrough",
                         "match_pricebook", "draft_line_items"):
            print(f"--- {t['node']} ---")
            _dump([t["output"]], truncate=900)

    _print_header("EVIDENCE: live DB rows")
    quote_db = client.table("quotes").select("*").eq("id", quote_id).execute().data
    items_db = (
        client.table("quote_line_items")
        .select("*")
        .eq("quote_id", quote_id)
        .order("position")
        .execute()
        .data
    )
    events_db = (
        client.table("quote_events")
        .select("event_type, payload, created_at")
        .eq("quote_id", quote_id)
        .order("id")
        .execute()
        .data
    )
    print("quotes:")
    _dump(quote_db)
    print(f"\nquote_line_items ({len(items_db)}):")
    _dump(items_db, truncate=600)
    print(f"\nquote_events ({len(events_db)}):")
    _dump(events_db, truncate=200)

    _print_header("INVARIANT CHECKS")
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))
        if not ok:
            failures.append(name)

    check("pipeline status completed", result["status"] == "completed")
    check(
        "quotes row completed in live DB",
        bool(quote_db) and quote_db[0]["status"] == "completed",
        f"status={quote_db[0]['status'] if quote_db else 'MISSING'}",
    )
    check(
        "bounded retry (retry_count <= 2)",
        bool(quote_db) and quote_db[0]["retry_count"] <= 2,
        f"retry_count={quote_db[0]['retry_count'] if quote_db else '?'}",
    )

    photo_ids = {pid for pid, _ in PHOTOS}
    check("line items exist", len(items_db) > 0, f"count={len(items_db)}")
    for item in items_db:
        cites = item["photo_citations"]
        check(
            f"citations non-empty + known: {item['description'][:40]!r}",
            bool(cites) and set(cites) <= photo_ids,
            f"citations={cites}",
        )

    book_prices = {
        row["id"]: row["unit_price_cents"]
        for row in client.table("price_book_items").select("id, unit_price_cents").execute().data
    }
    unpriced = 0
    for item in items_db:
        pb_id = item["price_book_item_id"]
        if pb_id is None:
            unpriced += 1
            check(
                f"unmatched item is unpriced: {item['description'][:40]!r}",
                item["unit_price_cents"] is None and item["total_cents"] is None,
                f"unit={item['unit_price_cents']} total={item['total_cents']}",
            )
        else:
            check(
                f"price comes from book: {item['description'][:40]!r}",
                item["unit_price_cents"] == book_prices.get(pb_id),
                f"item={item['unit_price_cents']} book={book_prices.get(pb_id)}",
            )
    check("at least one unpriced item (blinds task)", unpriced >= 1,
          f"unpriced={unpriced}")

    event_types = [e["event_type"] for e in events_db]
    check(
        "one line_item_drafted per final item (>=, retries re-emit)",
        event_types.count("line_item_drafted") >= len(items_db),
        f"drafted={event_types.count('line_item_drafted')} items={len(items_db)}",
    )
    check("exactly one generation_completed event",
          event_types.count("generation_completed") == 1)
    check(
        "retry_started events match retry_count",
        bool(quote_db)
        and event_types.count("retry_started") == quote_db[0]["retry_count"],
        f"events={event_types.count('retry_started')}",
    )

    seen_nodes = {t["node"] for t in traces}
    expected_nodes = {
        "transcribe", "analyze_photos", "parse_walkthrough",
        "match_pricebook", "draft_line_items", "validate", "compile_quote",
    }
    check("agent_traces cover all 7 nodes", expected_nodes <= seen_nodes,
          f"missing={expected_nodes - seen_nodes or '{}'}")

    _print_header("RESULT")
    if failures:
        print(f"FAILED: {len(failures)} invariant(s): {failures}")
        return 1
    print("ALL INVARIANTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
