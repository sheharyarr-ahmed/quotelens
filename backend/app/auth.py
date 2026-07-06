"""Supabase JWT verification (SPEC.md - Data flow, auth, and access):
mobile sends its Supabase access token; we verify the signature locally
with the project JWT secret and extract user_id. All backend DB access then
uses the service role with every query explicitly scoped to this user_id."""

import os

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

bearer = HTTPBearer()


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
) -> str:
    try:
        payload = jwt.decode(
            credentials.credentials,
            os.environ["SUPABASE_JWT_SECRET"],
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="invalid token")
    return payload["sub"]
