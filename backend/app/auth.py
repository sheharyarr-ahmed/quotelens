"""Supabase JWT verification (SPEC.md - Data flow, auth, and access):
mobile sends its Supabase access token; we verify the signature locally and
extract user_id. All backend DB access then uses the service role with every
query explicitly scoped to this user_id.

Projects on Supabase's current JWT signing keys issue ES256 tokens verified
against the project JWKS (fetched once and cached by PyJWKClient; the
signature check itself stays local). Projects on the legacy shared secret
issue HS256 tokens verified with SUPABASE_JWT_SECRET. The verification key
is selected by the token's declared algorithm, and each branch pins its own
`algorithms` list, so neither branch can be steered onto the other's key."""

import os
import ssl

import certifi
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

bearer = HTTPBearer()

_jwks_client: jwt.PyJWKClient | None = None


def _jwks() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(
            f"{os.environ['SUPABASE_URL']}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
            # PyJWKClient fetches over urllib, which does not use certifi's
            # CA bundle; without this the fetch fails with
            # CERTIFICATE_VERIFY_FAILED on Pythons that lack system CAs.
            ssl_context=ssl.create_default_context(cafile=certifi.where()),
        )
    return _jwks_client


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
) -> str:
    token = credentials.credentials
    try:
        if jwt.get_unverified_header(token).get("alg") == "ES256":
            try:
                key = _jwks().get_signing_key_from_jwt(token).key
            except jwt.exceptions.PyJWKClientConnectionError:
                # Server-side outage, not a bad token: a 401 here would make
                # clients treat a valid session as expired.
                raise HTTPException(
                    status_code=503, detail="auth keys unavailable"
                )
            algorithms = ["ES256"]
        else:
            secret = os.environ.get("SUPABASE_JWT_SECRET")
            if secret is None:
                # The header alg is attacker-chosen: on a signing-keys-only
                # deployment a non-ES256 token must 401, never KeyError->500.
                raise HTTPException(status_code=401, detail="invalid token")
            key = secret
            algorithms = ["HS256"]
        payload = jwt.decode(
            token,
            key,
            algorithms=algorithms,
            audience="authenticated",
            options={"require": ["sub", "exp"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="invalid token")
    return payload["sub"]
