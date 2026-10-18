from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .ai.llm import ai_configured
from .config import get_settings
from .db import close_pool, get_pool
from .routers import access, admin, ai, audit_log, caregivers, cognitive, doctor, emergency, me, notes, patients, qr, records


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    missing = [k for k in ("database_url", "qr_token_secret") if not getattr(s, k)]
    if missing:
        raise RuntimeError(f"Missing required settings: {', '.join(m.upper() for m in missing)}")
    get_pool()
    yield
    close_pool()


app = FastAPI(title="VitalID API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

for r in (me, patients, records, qr, emergency, access, doctor, notes, ai, cognitive, audit_log, admin, caregivers):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    with get_pool().connection() as conn:
        conn.execute("select 1")
    return {"ok": True, "ai_configured": ai_configured()}
