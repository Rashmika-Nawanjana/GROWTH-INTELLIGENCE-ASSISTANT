from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load root .env (repo root) then backend/.env
_ROOT = Path(__file__).resolve().parents[2]
_ENV_CANDIDATES = (
    _ROOT / ".env.local",
    _ROOT / ".env",
    _ROOT / "backend" / ".env",
)
for _env_path in _ENV_CANDIDATES:
    if _env_path.is_file():
        load_dotenv(_env_path, override=False)

_ENV_FILES = tuple(str(p) for p in _ENV_CANDIDATES if p.is_file()) or (str(_ROOT / ".env"),)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILES,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Supabase
    next_public_supabase_url: str = ""
    next_public_supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_db_url: str = ""

    # Gemini
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_embedding_model: str = "gemini-embedding-001"
    gemini_embedding_dimensions: int = 768
    gemini_thinking_budget: int = 0

    # Tools
    serpapi_key: str = ""
    firecrawl_api_key: str = ""
    scrape_do_token: str = ""
    apify_api_token: str = ""
    apify_max_wait_secs: int = 40
    apify_debug: str = ""
    apify_twitter_actor_id: str = "61RPP7dywgiy0JPD0"

    # Optional
    reddit_client_id: str = ""
    reddit_client_secret: str = ""
    meta_ads_token: str = ""

    # MiroFish
    mirofish_base_url: str = ""
    mirofish_simulations: str = "{}"
    mirofish_live_base_url: str = ""
    mirofish_live_simulations: str = "{}"
    mirofish_live_default_simulation_id: str = ""
    mirofish_live_max_agents: int = 5
    mirofish_live_interview_timeout_sec: int = 240
    mirofish_live_strict_serial_mode: str = "0"

    # Server
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    python_backend_url: str = "http://127.0.0.1:8000"

    @property
    def supabase_url(self) -> str:
        return self.next_public_supabase_url.strip()

    @property
    def supabase_anon_key(self) -> str:
        return self.next_public_supabase_anon_key.strip()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
