import uuid
import logging
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException

from app.config import settings
from app.core.audio import get_audio_info, convert_to_wav
from app.core.models import TrackInfo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tracks", tags=["tracks"])

# In-memory track registry (replace with DB in production)
_tracks: dict[str, TrackInfo] = {}


def get_track(track_id: str) -> TrackInfo | None:
    return _tracks.get(track_id)


def get_track_path(track_id: str) -> Path | None:
    """Get the WAV path for a track (used by processing pipeline)."""
    track = _tracks.get(track_id)
    if not track:
        return None
    wav_path = settings.upload_dir / f"{track_id}.wav"
    if wav_path.exists():
        return wav_path
    # Original file
    for ext in settings.allowed_extensions:
        p = settings.upload_dir / f"{track_id}{ext}"
        if p.exists():
            return p
    return None


@router.post("/upload", response_model=TrackInfo)
async def upload_track(file: UploadFile = File(...)):
    """Upload an audio file (MP3 or WAV). Preserves original quality."""
    # Validate extension
    if not file.filename:
        raise HTTPException(400, "Filename is required")

    ext = Path(file.filename).suffix.lower()
    if ext not in settings.allowed_extensions:
        raise HTTPException(
            400,
            f"Unsupported format '{ext}'. Allowed: {', '.join(settings.allowed_extensions)}",
        )

    # Validate file size
    content = await file.read()
    size_mb = len(content) / (1024 * 1024)
    if size_mb > settings.max_file_size_mb:
        raise HTTPException(413, f"File too large ({size_mb:.1f}MB). Max: {settings.max_file_size_mb}MB")

    # Save original file
    track_id = str(uuid.uuid4())
    original_path = settings.upload_dir / f"{track_id}{ext}"
    original_path.write_bytes(content)
    logger.info(f"Saved upload: {file.filename} -> {original_path} ({size_mb:.1f}MB)")

    # Convert to WAV if needed (Demucs processes WAV)
    wav_path = settings.upload_dir / f"{track_id}.wav"
    convert_to_wav(original_path, wav_path)

    # Extract audio metadata
    info = get_audio_info(wav_path)

    track = TrackInfo(
        track_id=track_id,
        filename=file.filename,
        duration=info["duration"],
        sample_rate=info["sample_rate"],
        channels=info["channels"],
        format=ext.lstrip("."),
        file_size_bytes=len(content),
    )
    _tracks[track_id] = track
    return track


@router.get("/{track_id}", response_model=TrackInfo)
async def get_track_info(track_id: str):
    """Get metadata for an uploaded track."""
    track = _tracks.get(track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    return track


@router.get("")
async def list_tracks():
    """List all uploaded tracks."""
    return list(_tracks.values())
