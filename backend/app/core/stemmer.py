"""
AI-powered stem separation engine using Meta's Demucs.

Demucs htdemucs_6s model separates audio into 6 stems:
  - vocals, drums, bass, guitar, piano, other

This is ideal for electronic music where you need fine-grained control
over synths (other), keys (piano), pads (guitar/other), drums, bass, and vocals.
"""

import uuid
import logging
import numpy as np
import torch
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from app.config import settings
from app.core.audio import load_audio, save_audio, slice_audio, replace_segment
from app.core.models import (
    StemType,
    StemOperation,
    ProcessingJob,
    ProcessingStatus,
)

logger = logging.getLogger(__name__)

# Global model cache — loaded once, reused across requests
_model = None
_model_lock = None


def _get_device() -> torch.device:
    """Select the best available compute device."""
    if torch.cuda.is_available():
        return torch.device("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def load_model():
    """Load the Demucs model (lazy singleton)."""
    global _model
    if _model is not None:
        return _model

    from demucs.pretrained import get_model
    from demucs.apply import apply_model

    logger.info(f"Loading Demucs model: {settings.demucs_model}")
    device = _get_device()
    logger.info(f"Using device: {device}")

    model = get_model(settings.demucs_model)
    model.to(device)
    model.eval()
    _model = model
    logger.info(f"Demucs model loaded successfully. Sources: {model.sources}")
    return _model


def separate_track(file_path: Path) -> dict[str, np.ndarray]:
    """
    Separate a full audio track into stems.
    Returns dict mapping stem name -> numpy array of audio data.
    """
    from demucs.apply import apply_model
    from demucs.audio import AudioFile

    model = load_model()
    device = _get_device()

    logger.info(f"Separating stems for: {file_path.name}")

    # Load audio as tensor: (channels, samples)
    wav = AudioFile(file_path).read(streams=0, samplerate=model.samplerate, channels=model.audio_channels)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std()
    wav = wav.unsqueeze(0).to(device)  # (1, channels, samples)

    # Run the model
    with torch.no_grad():
        sources = apply_model(model, wav, device=device)
    # sources shape: (1, num_sources, channels, samples)

    # Denormalize
    sources = sources * ref.std() + ref.mean()

    result = {}
    for i, source_name in enumerate(model.sources):
        # (channels, samples) -> (samples, channels)
        audio_np = sources[0, i].cpu().numpy().T
        result[source_name] = audio_np

    logger.info(f"Separation complete. Stems: {list(result.keys())}")
    return result


def apply_operations(
    original_audio: np.ndarray,
    stems: dict[str, np.ndarray],
    sample_rate: int,
    operations: list[StemOperation],
) -> np.ndarray:
    """
    Apply stem operations to the audio.

    For each operation:
    - 'remove': subtract the specified stem from the mix in the given time range
    - 'isolate': keep only the specified stem in the given time range
    """
    result = original_audio.copy()

    for op in operations:
        stem_name = op.stem.value
        if stem_name not in stems:
            logger.warning(f"Stem '{stem_name}' not found, skipping operation")
            continue

        start = op.time_range.start
        end = op.time_range.end

        stem_slice = slice_audio(stems[stem_name], sample_rate, start, end)
        original_slice = slice_audio(result, sample_rate, start, end)

        if op.action == "remove":
            # Remove stem: subtract stem from the mix
            new_slice = original_slice - stem_slice
        elif op.action == "isolate":
            # Isolate: keep only this stem
            new_slice = stem_slice
        else:
            continue

        # Clip to prevent distortion
        new_slice = np.clip(new_slice, -1.0, 1.0)
        result = replace_segment(result, new_slice, sample_rate, start)

    return result


# In-memory job store (replace with DB in production)
_jobs: dict[str, ProcessingJob] = {}
_executor = ThreadPoolExecutor(max_workers=2)


def get_job(job_id: str) -> ProcessingJob | None:
    return _jobs.get(job_id)


def create_processing_job(
    track_id: str,
    track_path: Path,
    operations: list[StemOperation],
    output_format: str = "wav",
) -> ProcessingJob:
    """Create and start an async processing job."""
    job_id = str(uuid.uuid4())
    job = ProcessingJob(
        job_id=job_id,
        track_id=track_id,
        status=ProcessingStatus.PENDING,
        operations=operations,
    )
    _jobs[job_id] = job

    _executor.submit(_run_job, job_id, track_path, operations, output_format)
    return job


def _run_job(
    job_id: str,
    track_path: Path,
    operations: list[StemOperation],
    output_format: str,
):
    """Background job: separate stems, apply operations, save output."""
    job = _jobs[job_id]
    try:
        # Step 1: Separate stems
        job.status = ProcessingStatus.SEPARATING
        job.progress = 10
        stems = separate_track(track_path)

        # Step 2: Load original audio
        job.status = ProcessingStatus.PROCESSING
        job.progress = 60
        original_audio, sample_rate = load_audio(track_path)

        # Step 3: Apply operations
        job.progress = 80
        processed = apply_operations(original_audio, stems, sample_rate, operations)

        # Step 4: Save output
        output_filename = f"{job.track_id}_{job_id[:8]}.{output_format}"
        output_path = settings.output_dir / output_filename
        save_audio(processed, sample_rate, output_path, output_format)

        job.output_file = str(output_path)
        job.status = ProcessingStatus.COMPLETE
        job.progress = 100
        logger.info(f"Job {job_id} complete: {output_path}")

    except Exception as e:
        logger.exception(f"Job {job_id} failed")
        job.status = ProcessingStatus.FAILED
        job.error = str(e)
