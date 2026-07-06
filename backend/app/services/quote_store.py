"""Persists pipeline outcomes via service role. Line items are replaced
wholesale per run: retries redraft the full set, so replace matches the
pipeline's whole-draft semantics."""

from app.pipeline.schemas import Quote


class SupabaseQuoteStore:
    def __init__(self, client):
        self.client = client

    def _owner_id(self, quote_id: str) -> str:
        result = (
            self.client.table("quotes")
            .select("user_id")
            .eq("id", quote_id)
            .execute()
        )
        return result.data[0]["user_id"]

    def save_completed(self, quote: Quote, retry_count: int) -> None:
        user_id = self._owner_id(quote.id)
        self.client.table("quote_line_items").delete().eq(
            "quote_id", quote.id
        ).execute()
        rows = [
            {
                "quote_id": quote.id,
                "user_id": user_id,
                "description": item.description,
                "quantity": item.quantity,
                "unit": item.unit,
                "unit_price_cents": item.unit_price_cents,
                "total_cents": item.total_cents,
                "price_book_item_id": item.price_book_item_id,
                "photo_citations": item.photo_citations,
                "confidence": item.confidence,
                "position": position,
            }
            for position, item in enumerate(quote.line_items)
        ]
        if rows:
            self.client.table("quote_line_items").insert(rows).execute()
        self.client.table("quotes").update(
            {
                "status": "completed",
                "subtotal_cents": quote.subtotal_cents,
                "retry_count": retry_count,
            }
        ).eq("id", quote.id).execute()

    def mark_failed(
        self, quote_id: str, errors: list[str], retry_count: int
    ) -> None:
        self.client.table("quotes").update(
            {"status": "failed", "retry_count": retry_count}
        ).eq("id", quote_id).execute()
