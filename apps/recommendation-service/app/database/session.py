from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import sessionmaker


def normalize_database_url(database_url: str) -> str:
    normalized = str(database_url or "").strip()
    if normalized.startswith("postgresql://"):
        return normalized.replace("postgresql://", "postgresql+psycopg://", 1)
    return normalized


def create_engine_for_url(database_url: str) -> Engine:
    normalized_url = normalize_database_url(database_url)
    connect_args = {}
    if normalized_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    return create_engine(
        normalized_url,
        future=True,
        pool_pre_ping=True,
        connect_args=connect_args,
    )


def create_session_factory(engine: Engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
