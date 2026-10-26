"""Persistence. SQLite locally, Postgres (Supabase) in production via DATABASE_URL.

World state is stored as versioned JSON documents (JSONB on Postgres): every simulation
and every shock writes a new row to world_state_versions, so history is never overwritten.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, LargeBinary, String, Text, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .contracts import PersonaMessage, Simulation
from .llm import CallRecord


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class SimRow(Base):
    __tablename__ = "simulation_runs"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    parent_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(16))
    mode: Mapped[str] = mapped_column(String(8))
    version: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(120), default="")
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class WorldVersionRow(Base):
    __tablename__ = "world_state_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    simulation_id: Mapped[str] = mapped_column(String(40), index=True)
    version: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(200))
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EventRow(Base):
    __tablename__ = "simulation_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    simulation_id: Mapped[str] = mapped_column(String(40), index=True)
    type: Mapped[str] = mapped_column(String(40))
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MessageRow(Base):
    __tablename__ = "persona_messages"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    simulation_id: Mapped[str] = mapped_column(String(40), index=True)
    role: Mapped[str] = mapped_column(String(16))
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AssetRow(Base):
    __tablename__ = "generated_assets"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    simulation_id: Mapped[str] = mapped_column(String(40), index=True)
    branch: Mapped[str] = mapped_column(String(2))
    kind: Mapped[str] = mapped_column(String(20))
    mime: Mapped[str] = mapped_column(String(40))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    prompt: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ModelCallRow(Base):
    __tablename__ = "model_calls"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    simulation_id: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    agent: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(60))
    provider: Mapped[str] = mapped_column(String(10))
    effort: Mapped[str | None] = mapped_column(String(10), nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0)
    searched: Mapped[bool] = mapped_column(Boolean, default=False)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Store:
    def __init__(self, url: str):
        if url.startswith("sqlite"):
            Path(url.split("///", 1)[-1]).parent.mkdir(parents=True, exist_ok=True)
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        self.engine = create_async_engine(url, pool_pre_ping=True)
        self.session: async_sessionmaker[AsyncSession] = async_sessionmaker(self.engine, expire_on_commit=False)
        self._conds: dict[str, asyncio.Condition] = {}

    async def init(self) -> None:
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            # Older local databases predate the cost ledger.
            try:
                await conn.execute(text("ALTER TABLE model_calls ADD COLUMN cost_usd FLOAT DEFAULT 0"))
            except Exception:
                pass

    # ---------------------------------------------------------------- simulations

    async def save(self, sim: Simulation, reason: str | None = None, parent_id: str | None = None) -> None:
        data = sim.model_dump(mode="json")
        async with self.session() as s, s.begin():
            row = await s.get(SimRow, sim.id)
            if row is None:
                row = SimRow(id=sim.id, parent_id=parent_id, status=sim.status, mode=sim.mode, version=sim.version,
                             title=sim.decision.title, data=data)
                s.add(row)
            else:
                row.status, row.mode, row.version, row.title, row.data = sim.status, sim.mode, sim.version, sim.decision.title, data
            if reason:
                s.add(WorldVersionRow(simulation_id=sim.id, version=sim.version, reason=reason, data=data))

    async def load(self, sim_id: str) -> Simulation | None:
        async with self.session() as s:
            row = await s.get(SimRow, sim_id)
            return Simulation.model_validate(row.data) if row else None

    async def parent_of(self, sim_id: str) -> str | None:
        async with self.session() as s:
            row = await s.get(SimRow, sim_id)
            return row.parent_id if row else None

    async def versions(self, sim_id: str) -> list[dict[str, Any]]:
        async with self.session() as s:
            rows = (await s.execute(select(WorldVersionRow.version, WorldVersionRow.reason, WorldVersionRow.created_at)
                                    .where(WorldVersionRow.simulation_id == sim_id).order_by(WorldVersionRow.id))).all()
            return [{"version": v, "reason": r, "created_at": c.isoformat()} for v, r, c in rows]

    async def version(self, sim_id: str, version: int) -> Simulation | None:
        async with self.session() as s:
            row = (await s.execute(select(WorldVersionRow).where(WorldVersionRow.simulation_id == sim_id, WorldVersionRow.version == version)
                                   .order_by(WorldVersionRow.id.desc()).limit(1))).scalar_one_or_none()
            return Simulation.model_validate(row.data) if row else None

    async def recent(self, limit: int = 20) -> list[dict[str, Any]]:
        async with self.session() as s:
            rows = (await s.execute(select(SimRow.id, SimRow.title, SimRow.status, SimRow.mode, SimRow.updated_at)
                                    .where(SimRow.parent_id.is_(None)).order_by(SimRow.updated_at.desc()).limit(limit))).all()
            return [{"id": i, "title": t, "status": st, "mode": m, "updated_at": u.isoformat()} for i, t, st, m, u in rows]

    async def delete(self, sim_id: str) -> None:
        from sqlalchemy import delete

        async with self.session() as s, s.begin():
            for model in (WorldVersionRow, EventRow, MessageRow, AssetRow, ModelCallRow):
                await s.execute(delete(model).where(model.simulation_id == sim_id))
            await s.execute(delete(SimRow).where(SimRow.id == sim_id))

    # ---------------------------------------------------------------- events (SSE)

    def _cond(self, sim_id: str) -> asyncio.Condition:
        if sim_id not in self._conds:
            self._conds[sim_id] = asyncio.Condition()
        return self._conds[sim_id]

    async def emit(self, sim_id: str, type: str, data: dict[str, Any]) -> int:
        async with self.session() as s, s.begin():
            row = EventRow(simulation_id=sim_id, type=type, data=data)
            s.add(row)
            await s.flush()
            seq = row.id
        cond = self._cond(sim_id)
        async with cond:
            cond.notify_all()
        return seq

    async def events_after(self, sim_id: str, after: int) -> list[EventRow]:
        async with self.session() as s:
            return list((await s.execute(select(EventRow).where(EventRow.simulation_id == sim_id, EventRow.id > after)
                                         .order_by(EventRow.id))).scalars())

    async def subscribe(self, sim_id: str, after: int = 0) -> AsyncIterator[EventRow | None]:
        """Yields stored events after `after`, then new ones as they arrive. None = keep-alive."""
        cond = self._cond(sim_id)
        while True:
            rows = await self.events_after(sim_id, after)
            for r in rows:
                after = r.id
                yield r
            try:
                async with cond:
                    await asyncio.wait_for(cond.wait(), timeout=15)
            except asyncio.TimeoutError:
                yield None

    # ---------------------------------------------------------------- messages, assets, calls

    async def add_message(self, sim_id: str, msg: PersonaMessage) -> None:
        async with self.session() as s, s.begin():
            s.add(MessageRow(id=msg.id, simulation_id=sim_id, role=msg.role, data=msg.model_dump(mode="json")))

    async def messages(self, sim_id: str) -> list[PersonaMessage]:
        async with self.session() as s:
            rows = (await s.execute(select(MessageRow).where(MessageRow.simulation_id == sim_id).order_by(MessageRow.created_at))).scalars()
            return [PersonaMessage.model_validate(r.data) for r in rows]

    async def add_asset(self, asset_id: str, sim_id: str, branch: str, kind: str, mime: str, data: bytes, prompt: str) -> None:
        async with self.session() as s, s.begin():
            s.add(AssetRow(id=asset_id, simulation_id=sim_id, branch=branch, kind=kind, mime=mime, data=data, prompt=prompt))

    async def asset(self, asset_id: str) -> AssetRow | None:
        async with self.session() as s:
            return await s.get(AssetRow, asset_id)

    async def assets_for(self, sim_id: str) -> list[dict[str, Any]]:
        async with self.session() as s:
            rows = (await s.execute(select(AssetRow.id, AssetRow.branch, AssetRow.kind, AssetRow.mime)
                                    .where(AssetRow.simulation_id == sim_id).order_by(AssetRow.created_at))).all()
            return [{"id": i, "branch": b, "kind": k, "mime": m, "url": f"/v1/assets/{i}"} for i, b, k, m in rows]

    async def log_call(self, rec: CallRecord) -> None:
        async with self.session() as s, s.begin():
            s.add(ModelCallRow(**rec.__dict__))

    async def total_cost(self) -> float:
        """Every dollar recorded against Meta, across all simulations, ever (the budget ledger)."""
        async with self.session() as s:
            v = (await s.execute(select(func.coalesce(func.sum(ModelCallRow.cost_usd), 0.0))
                                 .where(ModelCallRow.provider == "meta"))).scalar_one()
            return float(v or 0.0)

    async def calls(self, sim_id: str) -> list[dict[str, Any]]:
        async with self.session() as s:
            rows = (await s.execute(select(ModelCallRow).where(ModelCallRow.simulation_id == sim_id).order_by(ModelCallRow.id))).scalars()
            return [
                {k: getattr(r, k) for k in ("agent", "model", "provider", "effort", "latency_ms", "input_tokens", "output_tokens",
                                            "cached_tokens", "searched", "ok", "cost_usd")} | {"created_at": r.created_at.isoformat()}
                for r in rows
            ]

    async def call_count_since(self, sim_ids: list[str], since: datetime) -> int:
        async with self.session() as s:
            return (await s.execute(select(func.count()).select_from(ModelCallRow)
                                    .where(ModelCallRow.simulation_id.in_(sim_ids), ModelCallRow.created_at >= since))).scalar_one()
