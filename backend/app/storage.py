"""Supabase Storage via its REST API, using the service-role key (backend only)."""

import httpx

from .config import get_settings


def _headers() -> dict:
    key = get_settings().supabase_service_role_key
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def signed_url(bucket: str, path: str, expires_in: int = 300) -> str | None:
    s = get_settings()
    if not s.supabase_url or not path:
        return None
    try:
        resp = httpx.post(
            f"{s.supabase_url.rstrip('/')}/storage/v1/object/sign/{bucket}/{path}",
            headers=_headers(), json={"expiresIn": expires_in}, timeout=10,
        )
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    signed = resp.json().get("signedURL") or resp.json().get("signedUrl")
    return f"{s.supabase_url.rstrip('/')}/storage/v1{signed}" if signed else None


def download(bucket: str, path: str) -> bytes:
    s = get_settings()
    resp = httpx.get(f"{s.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{path}", headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.content


def upload(bucket: str, path: str, data: bytes, content_type: str) -> None:
    s = get_settings()
    if not s.supabase_url:
        raise RuntimeError("SUPABASE_URL is not configured")
    resp = httpx.post(
        f"{s.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{path}",
        headers={**_headers(), "Content-Type": content_type, "x-upsert": "false"},
        content=data, timeout=60,
    )
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"{resp.status_code} {resp.text[:200]}")


def remove(bucket: str, path: str) -> None:
    s = get_settings()
    if not s.supabase_url or not path:
        return
    try:
        httpx.request("DELETE", f"{s.supabase_url.rstrip('/')}/storage/v1/object/{bucket}",
                      headers=_headers(), json={"prefixes": [path]}, timeout=20)
    except httpx.HTTPError:
        pass
