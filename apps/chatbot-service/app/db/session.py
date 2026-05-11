from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def is_db_enabled() -> bool:
    return settings.CHATBOT_DB_ENABLED


def get_engine() -> AsyncEngine:
    global _engine

    if _engine is None:
        if not is_db_enabled():
            raise RuntimeError("Chatbot DB is disabled")

        _engine = create_async_engine(
            settings.DATABASE_URL,
            echo=settings.CHATBOT_DB_ECHO,
            pool_pre_ping=True,
            pool_size=settings.CHATBOT_DB_POOL_SIZE,
            max_overflow=settings.CHATBOT_DB_MAX_OVERFLOW,
            pool_timeout=settings.CHATBOT_DB_POOL_TIMEOUT_SECONDS,
            pool_recycle=settings.CHATBOT_DB_POOL_RECYCLE_SECONDS,
            connect_args={
                "command_timeout": settings.CHATBOT_DB_COMMAND_TIMEOUT_SECONDS,
            },
        )

    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory

    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
            class_=AsyncSession,
        )

    return _session_factory


async def get_db_session() -> AsyncIterator[AsyncSession]:
    if not is_db_enabled():
        raise RuntimeError("Chatbot DB is disabled")

    async with get_session_factory() as session:
        yield session


async def init_db():
    if not is_db_enabled():
        return

    # Ensure metadata is populated before create_all.
    import app.db.models  # noqa: F401

    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db():
    global _engine, _session_factory

    if _engine is None:
        return

    await _engine.dispose()
    _engine = None
    _session_factory = None
