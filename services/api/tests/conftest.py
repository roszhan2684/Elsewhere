import os
import tempfile

# Tests never call the real API.
os.environ["MODEL_MODE"] = "mock"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db"
