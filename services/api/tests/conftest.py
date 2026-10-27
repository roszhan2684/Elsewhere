import os
import tempfile

# Tests never call the real API.
os.environ["MODEL_MODE"] = "mock"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db"


import pytest

from elsewhere import budget


@pytest.fixture(autouse=True)
def _no_real_lock_or_ledger(tmp_path, monkeypatch):
    """Tests use their own lock file and no shared ledger, whatever state the real app is in."""
    monkeypatch.setattr(budget, "LIVE_LOCK", tmp_path / "LIVE_LOCKED")
    monkeypatch.setattr(budget, "_ledger", None)
