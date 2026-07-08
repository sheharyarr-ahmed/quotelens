"""Service-role data access. Every method takes the verified user_id
explicitly; RLS still guards direct-from-device access, this layer guards
the service-role path."""

import uuid

from app.pipeline.schemas import PhotoObservation, PriceBookItem, Transcript


class SupabaseQuoteRepo:
    def __init__(self, client):
        self.client = client

    def create_quote(self, user_id: str, job_id: str) -> dict:
        result = (
            self.client.table("quotes")
            .insert({"user_id": user_id, "job_id": job_id, "status": "generating"})
            .execute()
        )
        return result.data[0]

    def get_job(self, user_id: str, job_id: str) -> dict | None:
        result = (
            self.client.table("jobs")
            .select("*")
            .eq("id", job_id)
            .eq("user_id", user_id)
            .execute()
        )
        return result.data[0] if result.data else None

    def mark_generating(self, user_id: str, quote_id: str) -> None:
        """Flip a quote back to 'generating' before a regenerate re-run; the
        quotes UPDATE rides realtime so every open review screen drops back
        into the stage ticker (SPEC.md - Mobile UI/UX - failed state)."""
        (
            self.client.table("quotes")
            .update({"status": "generating"})
            .eq("id", quote_id)
            .eq("user_id", user_id)
            .execute()
        )

    def get_quote(self, user_id: str, quote_id: str) -> dict | None:
        result = (
            self.client.table("quotes")
            .select("*")
            .eq("id", quote_id)
            .eq("user_id", user_id)
            .execute()
        )
        return result.data[0] if result.data else None

    def register_capture(
        self, user_id: str, job_id: str, kind: str, storage_path: str
    ) -> dict:
        result = (
            self.client.table("captures")
            .insert(
                {
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "job_id": job_id,
                    "kind": kind,
                    "storage_path": storage_path,
                }
            )
            .execute()
        )
        return result.data[0]

    def get_active_price_book_items(self, user_id: str) -> list[PriceBookItem]:
        books = (
            self.client.table("price_books")
            .select("id, user_id, is_template")
            .eq("is_active", True)
            .or_(f"user_id.eq.{user_id},is_template.eq.true")
            .execute()
        )
        if not books.data:
            return []
        # The seeded template ships globally active, so once a user activates
        # their own book two rows match: the user's book must win
        # deterministically, never PostgREST's unspecified row order.
        chosen = sorted(
            books.data, key=lambda row: (row["user_id"] != user_id, row["id"])
        )[0]
        items = (
            self.client.table("price_book_items")
            .select("*")
            .eq("price_book_id", chosen["id"])
            .execute()
        )
        return [
            PriceBookItem(
                id=row["id"],
                name=row["name"],
                unit=row["unit"],
                unit_price_cents=row["unit_price_cents"],
                description=row.get("description"),
            )
            for row in items.data
        ]

    def cached_pipeline_context(
        self, quote_id: str
    ) -> tuple[Transcript | None, list[PhotoObservation] | None]:
        """Rebuild the cached transcript and observations from agent_traces
        so a regenerate never re-pays transcription or vision."""
        rows = (
            self.client.table("agent_traces")
            .select("node, output")
            .eq("quote_id", quote_id)
            .in_("node", ["transcribe", "analyze_photos"])
            .order("created_at", desc=True)
            .execute()
        )
        transcript = None
        observations = None
        for row in rows.data:
            if row["node"] == "transcribe" and transcript is None:
                transcript = Transcript.model_validate(row["output"])
            if row["node"] == "analyze_photos" and observations is None:
                observations = [
                    PhotoObservation.model_validate(observation)
                    for observation in row["output"]["observations"]
                ]
        return transcript, observations
