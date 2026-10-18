"""Integration tests against a real local PostgreSQL loaded with the Supabase migrations
(plus a small stand-in for Supabase's auth schema). Groq is stubbed; nothing leaves the machine.

Needs TEST_DATABASE_ADMIN_URL pointing at a server where we may create a scratch database,
e.g. postgresql://postgres@localhost:54329/postgres
"""

import os
import time
import uuid
from pathlib import Path

import jwt
import psycopg
import pytest

ROOT = Path(__file__).resolve().parents[2]
ADMIN_URL = os.environ.get("TEST_DATABASE_ADMIN_URL", "postgresql://postgres@localhost:54329/postgres")
DB_NAME = f"vitalid_test_{uuid.uuid4().hex[:8]}"
JWT_SECRET = "test-jwt-secret-" + uuid.uuid4().hex

os.environ.update(
    DATABASE_URL=ADMIN_URL.rsplit("/", 1)[0] + "/" + DB_NAME,
    SUPABASE_JWT_SECRET=JWT_SECRET,
    QR_TOKEN_SECRET="test-qr-secret-" + uuid.uuid4().hex,
    SUPABASE_URL="",
    GROQ_API_KEY="test-key",
    FRONTEND_URL="http://localhost:3000",
)

MIGRATIONS = [
    ROOT / "supabase/local/supabase_stub.sql",
    ROOT / "supabase/migrations/20261018000001_schema.sql",
    ROOT / "supabase/migrations/20261018000002_rls.sql",
    ROOT / "supabase/migrations/20261018000004_drug_reference.sql",
]


@pytest.fixture(scope="session", autouse=True)
def database():
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f"create database {DB_NAME}")
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as c:
        for f in MIGRATIONS:
            c.execute(f.read_text())
    yield
    from app.db import close_pool

    close_pool()
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f"drop database if exists {DB_NAME} with (force)")


@pytest.fixture(scope="session")
def client(database):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


def make_user(role: str, name: str, **meta) -> dict:
    """Creates an auth user (the signup trigger makes the profile) and returns auth headers."""
    uid = uuid.uuid4()
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as c:
        c.execute(
            "insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)",
            (uid, f"{uid.hex[:8]}@test.local", psycopg.types.json.Jsonb({"role": role, "full_name": name, **meta})),
        )
        profile_id = c.execute("select id from profiles where user_id = %s", (uid,)).fetchone()[0]
    token = jwt.encode(
        {"sub": str(uid), "aud": "authenticated", "role": "authenticated", "exp": int(time.time()) + 3600},
        JWT_SECRET, algorithm="HS256",
    )
    return {"user_id": uid, "profile_id": profile_id, "headers": {"Authorization": f"Bearer {token}"}}


def sql(query: str, params=None):
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as c:
        cur = c.execute(query, params)
        return cur.fetchall() if cur.description else None


@pytest.fixture
def fake_llm(monkeypatch):
    """Replaces the Groq HTTP call. Tests set `responses[<prompt keyword>] = json string`."""
    responses: dict[str, str] = {}
    calls: list[dict] = []

    def fake_chat(messages, *, model, temperature, json_mode=True):
        calls.append({"messages": messages, "model": model})
        system = messages[0]["content"]
        for key, value in responses.items():
            if key in system:
                return value
        raise AssertionError(f"No fake response for prompt: {system[:80]}")

    from app.ai import llm

    monkeypatch.setattr(llm, "_chat", fake_chat)
    return responses, calls
