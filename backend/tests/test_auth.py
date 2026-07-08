"""JWT verification paths: ES256 via JWKS (current Supabase signing keys)
and HS256 via the legacy shared secret. The live 401 this pins: hosted
projects sign with ES256, so an HS256-only verifier rejects every real
session token."""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import auth

HS_SECRET = "test-legacy-secret"


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _claims(**overrides):
    claims = {
        "sub": "user-123",
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    return claims


@pytest.fixture
def es256_keypair(monkeypatch):
    private = ec.generate_private_key(ec.SECP256R1())

    class FakeSigningKey:
        key = private.public_key()

    class FakeJWKSClient:
        def get_signing_key_from_jwt(self, token):
            return FakeSigningKey()

    monkeypatch.setattr(auth, "_jwks_client", FakeJWKSClient())
    return private


def test_es256_token_verifies_via_jwks(es256_keypair):
    token = jwt.encode(_claims(), es256_keypair, algorithm="ES256")
    assert auth.get_current_user_id(_creds(token)) == "user-123"


def test_es256_token_signed_by_other_key_rejected(es256_keypair):
    other = ec.generate_private_key(ec.SECP256R1())
    token = jwt.encode(_claims(), other, algorithm="ES256")
    with pytest.raises(HTTPException) as exc:
        auth.get_current_user_id(_creds(token))
    assert exc.value.status_code == 401


def test_hs256_token_verifies_with_legacy_secret(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", HS_SECRET)
    token = jwt.encode(_claims(), HS_SECRET, algorithm="HS256")
    assert auth.get_current_user_id(_creds(token)) == "user-123"


def test_hs256_wrong_secret_rejected(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", HS_SECRET)
    token = jwt.encode(_claims(), "not-the-secret", algorithm="HS256")
    with pytest.raises(HTTPException) as exc:
        auth.get_current_user_id(_creds(token))
    assert exc.value.status_code == 401


def test_wrong_audience_rejected(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", HS_SECRET)
    token = jwt.encode(_claims(aud="anon"), HS_SECRET, algorithm="HS256")
    with pytest.raises(HTTPException) as exc:
        auth.get_current_user_id(_creds(token))
    assert exc.value.status_code == 401


def test_expired_token_rejected(es256_keypair):
    token = jwt.encode(
        _claims(exp=int(time.time()) - 10), es256_keypair, algorithm="ES256"
    )
    with pytest.raises(HTTPException) as exc:
        auth.get_current_user_id(_creds(token))
    assert exc.value.status_code == 401


def test_hs256_token_without_legacy_secret_is_401_not_500(monkeypatch):
    """The header alg is attacker-chosen: a non-ES256 token on a deployment
    without the legacy secret must 401, never KeyError -> 500."""
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    token = jwt.encode(_claims(), "whatever", algorithm="HS256")
    with pytest.raises(HTTPException) as exc:
        auth.get_current_user_id(_creds(token))
    assert exc.value.status_code == 401


def test_jwks_outage_is_503_not_401(monkeypatch):
    """A JWKS fetch failure is a server-side outage; 401 would make clients
    drop valid sessions and force re-auth."""
    private = ec.generate_private_key(ec.SECP256R1())

    class OutageJWKSClient:
        def get_signing_key_from_jwt(self, token):
            raise jwt.exceptions.PyJWKClientConnectionError("fetch failed")

    monkeypatch.setattr(auth, "_jwks_client", OutageJWKSClient())
    token = jwt.encode(_claims(), private, algorithm="ES256")
    with pytest.raises(HTTPException) as exc:
        auth.get_current_user_id(_creds(token))
    assert exc.value.status_code == 503
