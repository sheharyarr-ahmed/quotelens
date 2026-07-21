"""Seed (or reset) the stable public sample quote for the hosted web page.

The Vercel-hosted /q/<share_token> page is a live, clickable portfolio link
(SPEC.md - Platform and distribution; Verification 6). It needs one persistent
quote that always renders. This script upserts that quote under a FIXED
share_token, so the README/EXPO_PUBLIC_WEB_URL link never changes, in status
'sent' so a visitor can exercise the Accept button.

Accept is a one-way flip anyone with the link can trigger, so the sample
"burns" to 'accepted' on the first click. Re-running this script is the reset
lever: it clears the accept event and its line items and puts the quote back to
'sent'. Fully idempotent - run it any number of times.

Run from backend/:
    set -a && source ../.env && set +a
    uv run python scripts/seed_web_sample.py [--email you@example.com]

Then open  {EXPO_PUBLIC_WEB_URL or Vercel URL}/q/<SHARE_TOKEN>  (printed below).
Writes to the live DB via the service role. Spends no tokens (no pipeline).
"""

import argparse
import os
import pathlib
import sys

BACKEND_ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

# Whose account owns the public sample. No hardcoded default: an unflagged run
# in a clone must not mutate whoever happened to publish the original sample.
DEFAULT_EMAIL = os.environ.get("QUOTELENS_DEMO_EMAIL")
REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]

# Fixed, deliberately-public token -> a stable README/app share link. The token
# is meant to be shared, so a readable value is fine (it is the capability, and
# this quote holds only sample data).
SHARE_TOKEN = "sample-water-damaged-bedroom"

# Hidden idempotency marker: the web page renders client_name + trade but never
# selects `address`, so we key the demo job off address without affecting what
# a visitor sees.
JOB_ADDRESS_MARKER = "QUOTELENS_WEB_SAMPLE"
CLIENT_NAME = "Danielle Okafor"
TRADE = "Painting"

# Painter / water-damaged bedroom, matching the demo story and the committed
# fixtures' photo ids. One inferred (vision-estimated) line and one unpriced
# line ('Replace ... blinds' -> renders "To be quoted"). photo_citations is
# non-empty on every row (DB check constraint).
LINE_ITEMS = [
    {
        "description": "Repaint bedroom walls, 2 coats",
        "quantity": 336,
        "unit": "sqft",
        "unit_price_cents": 180,
        "total_cents": 60480,
        "confidence": "stated",
        "photo_citations": ["photo-water-stain", "photo-scuffed-wall"],
    },
    {
        "description": "Prime water-stained ceiling",
        "quantity": 168,
        "unit": "sqft",
        "unit_price_cents": 95,
        "total_cents": 15960,
        "confidence": "inferred",
        "photo_citations": ["photo-water-stain"],
    },
    {
        "description": "Patch drywall behind door",
        "quantity": 1,
        "unit": "each",
        "unit_price_cents": 8500,
        "total_cents": 8500,
        "confidence": "stated",
        "photo_citations": ["photo-scuffed-wall"],
    },
    {
        "description": "Replace water-damaged window blinds",
        "quantity": 1,
        "unit": "each",
        "unit_price_cents": None,  # no price-book match -> unpriced ("To be quoted")
        "total_cents": None,
        "confidence": "stated",
        "photo_citations": ["photo-water-stain"],
    },
]
SUBTOTAL_CENTS = sum(i["total_cents"] for i in LINE_ITEMS if i["total_cents"])


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


def _find_or_create_job(client, user_id: str) -> str:
    """The dedicated demo job, keyed by the hidden address marker so re-runs
    reuse the same job instead of piling up new ones."""
    existing = (
        client.table("jobs")
        .select("id, user_id")
        .eq("user_id", user_id)
        .eq("address", JOB_ADDRESS_MARKER)
        .execute()
        .data
    )
    if existing:
        return existing[0]["id"]
    created = (
        client.table("jobs")
        .insert(
            {
                "user_id": user_id,
                "client_name": CLIENT_NAME,
                "address": JOB_ADDRESS_MARKER,
                "trade": TRADE,
                "status": "open",
            }
        )
        .execute()
        .data
    )
    return created[0]["id"]


def _line_item_rows(quote_id: str, user_id: str) -> list[dict]:
    return [
        {
            **item,
            "quote_id": quote_id,
            "user_id": user_id,
            "price_book_item_id": None,
            "position": position,
        }
        for position, item in enumerate(LINE_ITEMS)
    ]


def main() -> int:
    _load_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--email", default=DEFAULT_EMAIL, required=DEFAULT_EMAIL is None
    )
    args = parser.parse_args()

    client = _client()
    user_id = _resolve_user(client, args.email)
    job_id = _find_or_create_job(client, user_id)

    existing = (
        client.table("quotes")
        .select("id, user_id")
        .eq("share_token", SHARE_TOKEN)
        .execute()
        .data
    )

    if existing:
        quote_id = existing[0]["id"]
        if existing[0]["user_id"] != user_id:
            sys.exit(
                f"share_token {SHARE_TOKEN!r} belongs to another user "
                f"({existing[0]['user_id']}); refusing to overwrite."
            )
        # Reset a possibly-burned sample: drop the accept event and old lines,
        # then rebuild and flip back to 'sent'. quote_id ownership was just
        # verified; line items also carry user_id, so scope that delete by it
        # too (quote_events has no user_id column, so it stays quote_id-keyed).
        client.table("quote_events").delete().eq("quote_id", quote_id).execute()
        client.table("quote_line_items").delete().eq("quote_id", quote_id).eq(
            "user_id", user_id
        ).execute()
        client.table("quotes").update(
            {"status": "sent", "subtotal_cents": SUBTOTAL_CENTS, "job_id": job_id}
        ).eq("id", quote_id).eq("user_id", user_id).execute()
        action = "reset"
    else:
        quote_id = (
            client.table("quotes")
            .insert(
                {
                    "user_id": user_id,
                    "job_id": job_id,
                    "status": "sent",
                    "share_token": SHARE_TOKEN,
                    "subtotal_cents": SUBTOTAL_CENTS,
                }
            )
            .execute()
            .data[0]["id"]
        )
        action = "created"

    client.table("quote_line_items").insert(
        _line_item_rows(quote_id, user_id)
    ).execute()

    print("\n" + "=" * 60)
    print(f"SAMPLE {action}: quote_id={quote_id}")
    print(f"  status       = sent")
    print(f"  share_token  = {SHARE_TOKEN}")
    print(f"  line items   = {len(LINE_ITEMS)} (1 inferred, 1 unpriced)")
    print(f"  subtotal     = ${SUBTOTAL_CENTS / 100:.2f}")
    print("=" * 60)
    print(
        f"\nLive path:  <YOUR_VERCEL_URL>/q/{SHARE_TOKEN}"
        f"\nSet EXPO_PUBLIC_WEB_URL to that Vercel origin so app share links resolve."
        f"\nRe-run this script any time to reset the sample back to 'sent'."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
