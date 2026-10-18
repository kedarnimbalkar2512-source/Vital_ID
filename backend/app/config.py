from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration comes from environment variables (or backend/.env)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""  # only needed for projects still on the legacy HS256 JWT secret
    database_url: str = ""  # Postgres connection string (Supabase: Project Settings -> Database)

    # Groq
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "openai/gpt-oss-120b"
    groq_vision_model: str = "qwen/qwen3.8-27b"
    groq_timeout_sec: float = 30.0

    # App behaviour
    frontend_url: str = "http://localhost:3000"
    cors_origins: str = "http://localhost:3000"
    qr_token_secret: str = Field(default="", description="Long random string used to derive QR tokens")
    access_grant_hours: int = 24
    break_glass_hours: int = 4
    access_request_ttl_minutes: int = 30
    pin_max_failures: int = 5
    pin_lockout_minutes: int = 15
    emergency_rate_limit_per_minute: int = 30
    emergency_notify_cooldown_minutes: int = 10
    app_timezone: str = "Asia/Kolkata"

    # Cognitive alert rules (brief section 7)
    cognitive_baseline_tests: int = 3
    cognitive_recent_tests: int = 3
    cognitive_drop_threshold_pct: float = 20.0
    cognitive_trend_min_tests: int = 4
    cognitive_trend_min_drop_pct: float = 10.0
    digit_span_max: int = 8
    trail_points: int = 10

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
