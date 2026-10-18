"""Verifies the Supabase access token sent by the browser and loads the caller's profile."""

import time
from dataclasses import dataclass
from uuid import UUID

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, status

from .config import get_settings
from .db import tx


@dataclass
class CurrentUser:
    user_id: UUID
    profile_id: UUID
    role: str
    full_name: str
    patient_id: UUID | None = None
    doctor_id: UUID | None = None
    doctor_status: str | None = None

    @property
    def is_verified_doctor(self) -> bool:
        return self.doctor_id is not None and self.doctor_status == "verified"


_jwks_client: jwt.PyJWKClient | None = None
_user_cache: dict[str, tuple[float, str]] = {}
# Tolerates small clock differences between this machine and Supabase Auth, which
# otherwise reject a freshly issued token as "not yet valid" (iat in the future).
_CLOCK_LEEWAY_SECONDS = 30


def _jwks() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        url = f"{get_settings().supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        _jwks_client = jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)
    return _jwks_client


def _verify_with_auth_server(token: str) -> str:
    """Fallback: ask Supabase Auth who this token belongs to (works for any signing setup)."""
    cached = _user_cache.get(token)
    if cached and cached[0] > time.time():
        return cached[1]
    s = get_settings()
    resp = httpx.get(
        f"{s.supabase_url.rstrip('/')}/auth/v1/user",
        headers={"apikey": s.supabase_service_role_key, "Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if resp.status_code != 200:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session")
    sub = resp.json()["id"]
    _user_cache[token] = (time.time() + 60, sub)
    return sub


def verify_token(token: str) -> str:
    """Returns the auth user id (JWT `sub`) for a valid Supabase access token."""
    s = get_settings()
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed token")
    alg = header.get("alg")
    try:
        if alg == "HS256":
            if not s.supabase_jwt_secret:
                return _verify_with_auth_server(token)
            claims = jwt.decode(
                token, s.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated", leeway=_CLOCK_LEEWAY_SECONDS
            )
        elif alg in ("ES256", "RS256"):
            key = _jwks().get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token, key.key, algorithms=[alg], audience="authenticated", leeway=_CLOCK_LEEWAY_SECONDS
            )
        else:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unsupported token algorithm")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    return claims["sub"]


def load_user(auth_user_id: str) -> CurrentUser:
    with tx() as cur:
        cur.execute(
            """
            select pr.id as profile_id, pr.role, pr.full_name,
                   pt.id as patient_id, d.id as doctor_id, d.verification_status
            from profiles pr
            left join patients pt on pt.profile_id = pr.id
            left join doctors d on d.profile_id = pr.id
            where pr.user_id = %s
            """,
            (auth_user_id,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No VitalID profile for this account")
    return CurrentUser(
        user_id=UUID(auth_user_id),
        profile_id=row["profile_id"],
        role=row["role"],
        full_name=row["full_name"],
        patient_id=row["patient_id"],
        doctor_id=row["doctor_id"],
        doctor_status=row["verification_status"],
    )


def current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    return load_user(verify_token(authorization.split(" ", 1)[1].strip()))


def require_role(*roles: str):
    def dep(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"This action needs one of: {', '.join(roles)}")
        return user

    return dep


def require_verified_doctor(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if user.role != "doctor" or not user.doctor_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Doctor account required")
    if user.doctor_status != "verified":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your licence is awaiting admin verification")
    return user
