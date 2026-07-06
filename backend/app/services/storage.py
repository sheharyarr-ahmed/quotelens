BUCKET = "captures"


class SupabaseStorage:
    """Signed-URL access to the private media bucket via service role."""

    def __init__(self, client):
        self.client = client

    def create_signed_url(self, path: str, expires_in: int = 3600) -> str:
        result = self.client.storage.from_(BUCKET).create_signed_url(
            path, expires_in
        )
        return result["signedURL"]
