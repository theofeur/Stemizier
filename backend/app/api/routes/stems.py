import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.models import SeparationJob
from app.core.stemmer import (
    create_separation_job,
    get_separation_job,
    get_stem_files,
)
from app.api.routes.upload import get_track, get_track_path

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tracks", tags=["stems"])


@router.post("/{track_id}/separate", response_model=SeparationJob)
async def start_separation(track_id: str):
    """Start AI stem separation for an uploaded track."""
    track = get_track(track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    track_path = get_track_path(track_id)
    if not track_path:
        raise HTTPException(404, "Track file not found")

    job = create_separation_job(track_id, track_path)
    logger.info(f"Started separation job {job.job_id} for track {track_id}")
    return job


@router.get("/separation-jobs/{job_id}", response_model=SeparationJob)
async def get_separation_status(job_id: str):
    """Check the status of a separation job."""
    job = get_separation_job(job_id)
    if not job:
        raise HTTPException(404, "Separation job not found")
    return job


@router.get("/{track_id}/stems")
async def list_stems(track_id: str):
    """List available separated stems for a track."""
    stems = get_stem_files(track_id)
    if not stems:
        return {"stems": [], "ready": False}
    return {"stems": list(stems.keys()), "ready": True}


@router.get("/{track_id}/stems/{stem_name}")
async def get_stem_audio(track_id: str, stem_name: str):
    """Serve a separated stem audio file."""
    stems = get_stem_files(track_id)
    if not stems or stem_name not in stems:
        raise HTTPException(404, f"Stem '{stem_name}' not available")
    path = stems[stem_name]
    if not path.exists():
        raise HTTPException(500, "Stem file not found on disk")
    return FileResponse(
        str(path),
        media_type="audio/wav",
        filename=f"{stem_name}.wav",
    )
