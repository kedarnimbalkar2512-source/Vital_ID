"""LOCAL DEVELOPMENT ONLY. A tiny stand-in for Supabase Auth (GoTrue) so the whole app can be
clicked through against a local PostgreSQL without Docker. It implements just the endpoints
supabase-js uses for email/password auth and signs HS256 tokens with SUPABASE_JWT_SECRET.
Never deploy this; use a real Supabase project.

Run from backend/ (needs its virtualenv and .env):
    LOCAL_DEMO_PASSWORD=... .venv/bin/python ../supabase/local/fake_auth.py
"""

import os
import sys
import time
import uuid
from pathlib import Path

import jwt
import psycopg
import uvicorn
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path.cwd()))
from app.config import get_settings  # noqa: E402

s = get_settings()
SECRET = s.supabase_jwt_secret
DEMO_PASSWORD = os.environ.get("LOCAL_DEMO_PASSWORD")
ph = PasswordHasher()
refresh_tokens: dict[str, str] = {}

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def db():
    return psycopg.connect(s.database_url, row_factory=dict_row, autocommit=True)


def user_json(u: dict) -> dict:
    return {
        "id": str(u["id"]), "aud": "authenticated", "role": "authenticated", "email": u["email"],
        "user_metadata": u["raw_user_meta_data"] or {}, "app_metadata": {"provider": "email"},
        "created_at": u["created_at"].isoformat(), "email_confirmed_at": u["created_at"].isoformat(),
    }


def session(u: dict) -> dict:
    now = int(time.time())
    token = jwt.encode({"sub": str(u["id"]), "aud": "authenticated", "role": "authenticated", "email": u["email"],
                        "iat": now, "exp": now + 3600}, SECRET, algorithm="HS256")
    refresh = uuid.uuid4().hex
    refresh_tokens[refresh] = str(u["id"])
    return {"access_token": token, "token_type": "bearer", "expires_in": 3600, "expires_at": now + 3600,
            "refresh_token": refresh, "user": user_json(u)}


@app.post("/auth/v1/signup")
async def signup(req: Request):
    body = await req.json()
    with db() as c:
        if c.execute("select 1 from auth.users where email = %s", (body["email"],)).fetchone():
            raise HTTPException(422, {"msg": "User already registered"})
        u = c.execute(
            "insert into auth.users (email, raw_user_meta_data, encrypted_password) values (%s, %s, %s) returning *",
            (body["email"], Jsonb(body.get("data") or {}), ph.hash(body["password"])),
        ).fetchone()
    return session(u)


@app.post("/auth/v1/token")
async def token(req: Request, grant_type: str):
    body = await req.json()
    with db() as c:
        if grant_type == "password":
            u = c.execute("select * from auth.users where email = %s", (body.get("email"),)).fetchone()
            ok = False
            if u and u["encrypted_password"]:
                try:
                    ok = ph.verify(u["encrypted_password"], body.get("password", ""))
                except VerifyMismatchError:
                    ok = False
            elif u and DEMO_PASSWORD:
                ok = body.get("password") == DEMO_PASSWORD  # seeded demo users have no password locally
            if not ok:
                raise HTTPException(400, {"error": "invalid_grant", "error_description": "Invalid login credentials"})
            return session(u)
        if grant_type == "refresh_token":
            uid = refresh_tokens.pop(body.get("refresh_token"), None)
            if not uid:
                raise HTTPException(400, {"error": "invalid_grant", "error_description": "Invalid refresh token"})
            return session(c.execute("select * from auth.users where id = %s", (uid,)).fetchone())
    raise HTTPException(400, "unsupported grant_type")


@app.get("/auth/v1/user")
def user(authorization: str = Header()):
    claims = jwt.decode(authorization.split()[1], SECRET, algorithms=["HS256"], audience="authenticated")
    with db() as c:
        return user_json(c.execute("select * from auth.users where id = %s", (claims["sub"],)).fetchone())


@app.post("/auth/v1/logout")
def logout():
    return None


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=54321)
