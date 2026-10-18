from contextlib import contextmanager
from typing import Iterator
from uuid import UUID

from psycopg import Cursor
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import get_settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        url = get_settings().database_url
        if not url:
            raise RuntimeError("DATABASE_URL is not set")
        # prepare_threshold=None keeps us compatible with Supabase's transaction pooler.
        _pool = ConnectionPool(
            url, min_size=1, max_size=10, kwargs={"prepare_threshold": None, "autocommit": True}, open=True
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def tx(actor_profile_id: UUID | str | None = None) -> Iterator[Cursor]:
    """One transaction. The actor is exposed to the audit trigger via app.actor_profile_id."""
    with get_pool().connection() as conn:
        with conn.transaction():
            with conn.cursor(row_factory=dict_row) as cur:
                if actor_profile_id:
                    cur.execute("select set_config('app.actor_profile_id', %s, true)", (str(actor_profile_id),))
                yield cur
