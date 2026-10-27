"""Runtime settings, read from environment variables (or services/api/.env)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = API_ROOT.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=API_ROOT / ".env", extra="ignore")

    model_api_key: str = ""
    model_base_url: str = "https://api.meta.ai/v1"

    # Model ids (docs/meta-api-notes.md)
    orchestrator_model: str = "muse-wonder-1.0"
    specialist_model: str = "muse-spark-1.3"
    image_model: str = "muse-image-1.0"
    transcribe_model: str = "muse-voice-transcribe-1.0"

    # Live Meta calls happen ONLY when MODEL_MODE=live AND a key is set. Anything else = offline mock.
    model_mode: str = "mock"

    # Hard spending cap enforced by Elsewhere itself (Meta only offers an email alert, not a cap).
    # Each environment (laptop, production) has its own cap; keep their SUM under your free credits.
    budget_usd: float = 0.0
    # Cost estimates are multiplied by this so we always over-count, never under-count.
    budget_safety_factor: float = 1.15

    database_url: str = f"sqlite+aiosqlite:///{API_ROOT / 'data' / 'elsewhere.db'}"
    cors_origins: str = "http://localhost:3000"

    # Live calls allowed per IP per hour on public demo forks
    demo_live_calls_per_hour: int = 30

    @property
    def live(self) -> bool:
        from .budget import live_locked  # the demo-mode lock beats every env setting

        return self.model_mode == "live" and bool(self.model_api_key) and self.budget_usd > 0 and not live_locked()


@lru_cache
def get_settings() -> Settings:
    return Settings()
