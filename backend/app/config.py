import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Stemizer"
    debug: bool = os.getenv("DEBUG", "false").lower() == "true"

    # File storage
    upload_dir: Path = Path("storage/uploads")
    output_dir: Path = Path("storage/outputs")
    max_file_size_mb: int = 500  # Max upload size in MB
    allowed_extensions: set[str] = {".mp3", ".wav"}

    # Audio processing
    sample_rate: int = 44100  # Preserve full quality
    demucs_model: str = "htdemucs_6s"  # 6-stem model: vocals, drums, bass, guitar, piano, other

    # CORS
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    class Config:
        env_file = ".env"


settings = Settings()

# Ensure storage directories exist
settings.upload_dir.mkdir(parents=True, exist_ok=True)
settings.output_dir.mkdir(parents=True, exist_ok=True)
