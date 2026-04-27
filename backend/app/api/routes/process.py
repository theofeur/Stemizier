import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path

from app.core.models import ProcessRequest, ProcessingJob
from app.core.stemmer import create_processing_job, get_job
from app.api.routes.upload import get_track, get_track_path

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/process", tags=["processing"])


@router.post("", response_model=ProcessingJob)
async def start_processing(request: ProcessRequest):
    """
    Start a stem processing job.

    Submit a list of operations, each specifying:
    - which stem to target (vocals, drums, bass, guitar, piano, other)
    - the time range (start/end in seconds)
    - the action: 'remove' to strip the stem, 'isolate' to keep only that stem
    """
    track = get_track(request.track_id)
    if not track:
        raise HTTPException(404, "Track not found. Upload a track first.")

    track_path = get_track_path(request.track_id)
    if not track_path:
        raise HTTPException(404, "Track file not found on disk.")

    # Validate time ranges against track duration
    for op in request.operations:
        if op.time_range.end > track.duration:
            raise HTTPException(
                400,
                f"Time range end ({op.time_range.end}s) exceeds track duration ({track.duration}s)",
            )
        if op.time_range.start >= op.time_range.end:
            raise HTTPException(400, "Time range start must be before end")

    job = create_processing_job(
        track_id=request.track_id,
        track_path=track_path,
        operations=request.operations,
        output_format=request.output_format,
    )
    logger.info(f"Created job {job.job_id} for track {request.track_id}")
    return job


@router.get("/jobs/{job_id}", response_model=ProcessingJob)
async def get_job_status(job_id: str):
    """Check the status of a processing job."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.get("/jobs/{job_id}/download")
async def download_result(job_id: str):
    """Download the processed audio file once the job is complete."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status != "complete":
        raise HTTPException(400, f"Job is not complete (status: {job.status})")
    if not job.output_file:
        raise HTTPException(500, "Output file path missing")

    output_path = Path(job.output_file)
    if not output_path.exists():
        raise HTTPException(500, "Output file not found on disk")

    media_type = "audio/wav" if output_path.suffix == ".wav" else "audio/mpeg"
    return FileResponse(
        path=str(output_path),
        media_type=media_type,
        filename=output_path.name,
    )
