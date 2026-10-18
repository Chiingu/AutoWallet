from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """ Pydantic = validates inputs."""
    database_url: str
    secret_key: str
    redis_url: str
    bank_simulator_url: str
    poll_interval_seconds: int = 60
    # Email for the GDPR confirmations (app/gdpr). In development: Mailpit on localhost:1025.
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_from: str = "AutoWallet <no-reply@autowallet.local>"
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    frontend_google_callback_url: str
    frontend_email_verify_url: str = ("http://localhost:5173/auth/verify-email")
    frontend_password_reset_url: str = ("http://localhost:5173/auth/reset-password")
    password_reset_ttl_seconds: int = 900

    # AI assistant (app/ai): any OpenAI-compatible API (Gemini, OpenRouter, OpenAI...)
    ai_api_key: str | None = None
    ai_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    ai_model: str = "gemini-3.5-flash-lite"
    ai_rate_limit_per_minute: int = 20
    postgres_user: str
    postgres_password: str
    postgres_db: str

    class Config:
        env_file = ".env"

settings = Settings()
