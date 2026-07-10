"""Seed a demo job's media and drive the real pipeline for the sim walkthrough.

The iOS simulator has no camera, so the walk-and-talk capture screen can't
produce photos. This seeds the committed fixtures (backend/tests/fixtures) as a
job's captures and runs the real pipeline, so the review screen can be exercised
on a simulator. Split into two phases so the app can watch LIVE assembly:

    # Phase 1 - seed media + captures, create the quote (status 'generating').
    #           Prints QUOTE_ID. The job now shows a "Generating" badge; open it
    #           in the app so it subscribes to realtime BEFORE the pipeline runs.
    uv run python scripts/seed_live_demo.py seed [--email you@example.com] [--job-id UUID]

    # Phase 2 - run the pipeline for that quote; the subscribed app sees the
    #           stage ticker advance and line items animate in over ~35s.
    uv run python scripts/seed_live_demo.py run <QUOTE_ID>

Run from backend/:  set -a && source ../.env && set +a && uv run python scripts/seed_live_demo.py ...
Spends real tokens and writes to the live DB (same as integration_run.py).
"""

import argparse
import pathlib
import sys
import time

BACKEND_ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

FIXTURES = BACKEND_ROOT / "tests" / "fixtures"
DEFAULT_EMAIL = "sheharyar.softwareengineer@gmail.com"

PHOTOS = [  # (photo_id, fixture filename) - photo_id is derived from the stem on read-back
    ("photo-water-stain", "photo-water-stain.jpg"),
    ("photo-scuffed-wall", "photo-scuffed-wall.jpg"),
]
AUDIO_FIXTURE = "voice-note.wav"
REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]


def _load_env() -> None:
    import os

    env_file = BACKEND_ROOT.parent / ".env"
    if all(os.environ.get(k) for k in REQUIRED_ENV) or not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _client():
    import os

    from supabase import create_client

    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        sys.exit(f"missing env vars: {missing}")
    return create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )


def _resolve_user(client, email: str) -> str:
    for user in client.auth.admin.list_users():
        if user.email == email:
            return user.id
    sys.exit(
        f"No auth user for {email!r}. Sign into the app with this email first "
        f"(so the account exists), then re-run."
    )


def _pick_job(client, user_id: str, job_id_arg: str | None) -> tuple[str, str]:
    """Return (job_id, client_name). Prefer the newest job that has no quote yet
    (the one just created in the UI); --job-id overrides."""
    if job_id_arg:
        row = (
            client.table("jobs")
            .select("id, client_name, user_id")
            .eq("id", job_id_arg)
            .execute()
            .data
        )
        if not row or row[0]["user_id"] != user_id:
            sys.exit(f"job {job_id_arg} not found for this user")
        return job_id_arg, row[0]["client_name"]

    jobs = (
        client.table("jobs")
        .select("id, client_name, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    if not jobs:
        sys.exit(
            "You have no jobs. Create one in the app first "
            "(New job -> name it -> Start capture), then re-run."
        )
    quoted = {
        q["job_id"]
        for q in client.table("quotes")
        .select("job_id")
        .eq("user_id", user_id)
        .execute()
        .data
    }
    for job in jobs:
        if job["id"] not in quoted:
            return job["id"], job["client_name"]
    sys.exit(
        "Every job of yours already has a quote. Create a fresh job in the app "
        "(New job -> Start capture -> back out), then re-run `seed`."
    )


def _upload_media(client, user_id: str, job_id: str) -> None:
    # Reset any captures left by an aborted in-app session (e.g. an auto-recorded
    # audio row) so the seeded set is exactly the three fixtures - deterministic
    # regardless of whether the user exited via Discard or a reload.
    client.table("captures").delete().eq("job_id", job_id).execute()

    bucket = client.storage.from_("captures")
    uploads = [(AUDIO_FIXTURE, "audio/wav")] + [(f, "image/jpeg") for _, f in PHOTOS]
    for filename, content_type in uploads:
        path = f"{user_id}/{job_id}/{filename}"
        bucket.upload(
            path,
            (FIXTURES / filename).read_bytes(),
            {"content-type": content_type, "upsert": "true"},
        )
    rows = [("audio", f"{user_id}/{job_id}/{AUDIO_FIXTURE}")] + [
        ("photo", f"{user_id}/{job_id}/{fname}") for _, fname in PHOTOS
    ]
    for kind, path in rows:
        client.table("captures").insert(
            {"user_id": user_id, "job_id": job_id, "kind": kind, "storage_path": path}
        ).execute()


def cmd_seed(args) -> int:
    client = _client()
    user_id = _resolve_user(client, args.email)
    job_id, client_name = _pick_job(client, user_id, args.job_id)

    from app.db.repo import SupabaseQuoteRepo

    _upload_media(client, user_id, job_id)
    quote_id = SupabaseQuoteRepo(client).create_quote(user_id, job_id)["id"]

    print("\n" + "=" * 60)
    print(f"SEEDED  job='{client_name}'  job_id={job_id}")
    print(f"QUOTE_ID={quote_id}")
    print("=" * 60)
    print(
        "\nNext: in the app, pull-to-refresh the Jobs list, then tap the\n"
        f"'{client_name}' card (now badged 'Generating'). You'll land on the\n"
        "quote screen with the stage ticker waiting. THEN run:\n"
        f"    uv run python scripts/seed_live_demo.py run {quote_id}"
    )
    return 0


def cmd_run(args) -> int:
    client = _client()
    quote = (
        client.table("quotes")
        .select("id, user_id, job_id, status")
        .eq("id", args.quote_id)
        .execute()
        .data
    )
    if not quote:
        sys.exit(f"quote {args.quote_id} not found")
    quote = quote[0]
    job_id = quote["job_id"]

    from app.db.repo import SupabaseQuoteRepo
    from app.pipeline.graph import graph
    from app.pipeline.schemas import PhotoRef
    from app.pipeline.state import PipelineState
    from app.services.factory import build_services_from_env

    caps = (
        client.table("captures")
        .select("kind, storage_path")
        .eq("job_id", job_id)
        .execute()
        .data
    )
    audio_path = next(c["storage_path"] for c in caps if c["kind"] == "audio")
    photo_refs = [
        PhotoRef(photo_id=pathlib.PurePath(c["storage_path"]).stem, storage_path=c["storage_path"])
        for c in caps
        if c["kind"] == "photo"
    ]
    price_book_items = SupabaseQuoteRepo(client).get_active_price_book_items(quote["user_id"])
    print(
        f"Running pipeline: quote={args.quote_id} photos={len(photo_refs)} "
        f"price_items={len(price_book_items)}"
    )

    state = PipelineState(
        job_id=job_id,
        quote_id=args.quote_id,
        audio_path=audio_path,
        photos=photo_refs,
        price_book_items=price_book_items,
    )
    started = time.monotonic()
    result = graph.invoke(state, context=build_services_from_env())
    print(f"\ngraph.invoke finished in {time.monotonic() - started:.1f}s status={result['status']}")

    items = (
        client.table("quote_line_items")
        .select("description, quantity, unit_price_cents, total_cents, photo_citations")
        .eq("quote_id", args.quote_id)
        .order("position")
        .execute()
        .data
    )
    print(f"\nline items ({len(items)}):")
    for it in items:
        price = "unpriced" if it["total_cents"] is None else f"${it['total_cents'] / 100:.2f}"
        print(f"  - {it['description'][:50]:<50} {price:>10}  cites={it['photo_citations']}")
    return 0


def main() -> int:
    _load_env()
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_seed = sub.add_parser("seed", help="seed media + create the quote (generating)")
    p_seed.add_argument("--email", default=DEFAULT_EMAIL)
    p_seed.add_argument("--job-id", default=None)
    p_seed.set_defaults(func=cmd_seed)

    p_run = sub.add_parser("run", help="run the pipeline for a seeded quote")
    p_run.add_argument("quote_id")
    p_run.set_defaults(func=cmd_run)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
