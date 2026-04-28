"""
AI-powered stem separation engine using UVR5 / BS-RoFormer.

Uses the `audio-separator` library (python-audio-separator) which wraps
the Ultimate Vocal Remover models. The pipeline:

1. BS-RoFormer (best-in-class vocal separation, SDR 12.97) for vocals/instrumental
2. Demucs htdemucs_ft via audio-separator for drums/bass/other from the instrumental

This gives high-quality electronic music stem separation:
  - vocals (BS-RoFormer)
  - drums, bass, other (Demucs from instrumental)
  - instrumental (full instrumental from BS-RoFormer)
"""

import uuid
import logging
import numpy as np
import soundfile as sf
from pathlib import Path
from typing import Callable
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from tqdm import tqdm as _original_tqdm

from app.config import settings
from app.core.audio import load_audio, save_audio, slice_audio, replace_segment
from app.core.models import (
    StemType,
    StemOperation,
    ProcessingJob,
    ProcessingStatus,
    SeparationJob,
)

logger = logging.getLogger(__name__)

# Cached separator instances per model
_separators: dict[str, object] = {}

# Thread-local progress callback for intercepting tqdm
import threading
_progress_local = threading.local()


class _ProgressTqdm(_original_tqdm):
    """A tqdm subclass that reports progress to a callback."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Notify that a new bar was created (for multi-pass tracking)
        on_new_bar = getattr(_progress_local, "on_new_bar", None)
        if on_new_bar:
            on_new_bar()

    def update(self, n=1):
        super().update(n)
        cb = getattr(_progress_local, "callback", None)
        if cb and self.total:
            cb(self.n, self.total)


def _get_separator(model_filename: str, demucs_params: dict | None = None):
    """Get or create a cached Separator instance for the given model."""
    # Use a cache key that includes params so different quality settings get different instances
    cache_key = f"{model_filename}:{hash(str(demucs_params))}" if demucs_params else model_filename
    if cache_key in _separators:
        return _separators[cache_key]

    from audio_separator.separator import Separator

    logger.info(f"Loading model: {model_filename}")

    output_dir = str(settings.output_dir.resolve())
    kwargs = dict(
        model_file_dir=str(settings.model_dir.resolve()),
        output_dir=output_dir,
        output_format="WAV",
        sample_rate=settings.sample_rate,
        normalization_threshold=1.0,  # No normalization — preserve dynamics
    )
    if demucs_params:
        kwargs["demucs_params"] = demucs_params

    separator = Separator(**kwargs)
    separator.load_model(model_filename=model_filename)
    _separators[cache_key] = separator
    logger.info(f"Model loaded: {model_filename}")
    return separator


def _resolve_output_path(out_file: str) -> Path:
    """Resolve an output file path from audio-separator (may be relative or just a filename)."""
    out_path = Path(out_file)
    if out_path.is_absolute() and out_path.exists():
        return out_path
    # audio-separator often returns just the filename — resolve against output_dir
    resolved = settings.output_dir.resolve() / out_path.name
    if resolved.exists():
        return resolved
    # Try as-is
    if out_path.exists():
        return out_path
    raise FileNotFoundError(f"Cannot find output file: {out_file} (tried {resolved})")


def separate_track(
    file_path: Path,
    progress_callback: Callable[[int], None] | None = None,
    quality: str = "high",
) -> dict[str, np.ndarray]:
    """
    Separate a full audio track into stems using a multi-model pipeline.

    Pipeline:
    1. BS-RoFormer → vocals + instrumental
    2. Demucs htdemucs_ft on original → drums, bass, other

    Quality presets:
    - "fast": shifts=1, overlap=0.25 (~1-2 min)
    - "balanced": shifts=5, overlap=0.5 (~3-5 min)
    - "high": shifts=10, overlap=0.75 (~8-15 min)

    Returns dict mapping stem name -> numpy array (samples, channels).
    progress_callback receives an integer 0-100 representing overall progress.
    """
    logger.info(f"Starting stem separation for: {file_path.name} (quality={quality})")
    results: dict[str, np.ndarray] = {}

    # Quality presets for Demucs
    QUALITY_PARAMS = {
        "fast": {"shifts": 1, "overlap": 0.25, "num_passes": 2},
        "balanced": {"shifts": 5, "overlap": 0.5, "num_passes": 10},
        "high": {"shifts": 10, "overlap": 0.75, "num_passes": 20},
    }
    qp = QUALITY_PARAMS.get(quality, QUALITY_PARAMS["high"])

    # High water mark — never allow progress to go backwards
    _max_pct = [0]

    def _report(pct: int):
        if progress_callback:
            if pct > _max_pct[0]:
                _max_pct[0] = pct
            progress_callback(_max_pct[0])

    def _step1_tqdm_cb(current: int, total: int):
        # Step 1 maps to 10-50% of overall progress
        pct = 10 + int((current / total) * 40)
        _report(pct)

    # Track how many tqdm bars Demucs has spawned to spread progress evenly
    _demucs_bars = [-1]  # starts at -1 because first __init__ increments to 0
    _demucs_num_passes = qp["num_passes"]  # shifts * 2

    def _step2_tqdm_cb(current: int, total: int):
        # Step 2 maps to 55-90% of overall progress, split across multiple passes
        pass_idx = _demucs_bars[0]
        per_pass = 35 / _demucs_num_passes
        base = 55 + int(pass_idx * per_pass)
        pct = base + int((current / total) * per_pass)
        _report(pct)

    # --- Step 1: BS-RoFormer for vocals/instrumental ---
    vocal_model = settings.stem_models["vocals"]
    separator = _get_separator(vocal_model)
    logger.info("Step 1/2: Separating vocals with BS-RoFormer...")
    _report(10)

    _progress_local.callback = _step1_tqdm_cb
    try:
        output_files = separator.separate(str(file_path))
    finally:
        _progress_local.callback = None

    _report(50)
    logger.info(f"BS-RoFormer output files: {output_files}")

    # audio-separator returns list of output file paths
    # BS-RoFormer produces: [vocals_path, instrumental_path]
    instrumental_path = None
    for out_file in output_files:
        out_path = _resolve_output_path(out_file)
        data, sr = sf.read(str(out_path), dtype="float32", always_2d=True)
        name = out_path.stem.lower()
        if "vocal" in name:
            results["vocals"] = data
        elif "instrumental" in name or "instrum" in name:
            results["instrumental"] = data
            instrumental_path = out_path
        else:
            # Fallback: second file is usually instrumental
            results["instrumental"] = data
            instrumental_path = out_path

    if "instrumental" not in results:
        logger.warning("No instrumental stem found, using original as fallback")
        results["instrumental"], _ = load_audio(file_path)
        instrumental_path = file_path

    # --- Step 2: Demucs on ORIGINAL file for drums/bass/other ---
    # Running on original (not instrumental) avoids cascading artifacts.
    # Quality settings come from the selected preset.
    demucs_model = settings.stem_models["drums"]  # htdemucs_ft handles all 4 stems
    demucs_hq_params = {
        "segment_size": "Default",
        "shifts": qp["shifts"],
        "overlap": qp["overlap"],
        "segments_enabled": True,
    }
    separator2 = _get_separator(demucs_model, demucs_params=demucs_hq_params)
    logger.info(f"Step 2/2: Separating drums/bass/other with Demucs (shifts={qp['shifts']}, overlap={qp['overlap']})...")
    _report(55)

    def _on_new_demucs_bar():
        _demucs_bars[0] += 1

    _progress_local.callback = _step2_tqdm_cb
    _progress_local.on_new_bar = _on_new_demucs_bar
    try:
        output_files2 = separator2.separate(str(file_path))
    finally:
        _progress_local.callback = None
        _progress_local.on_new_bar = None

    _report(90)
    logger.info(f"Demucs output files: {output_files2}")

    for out_file in output_files2:
        out_path = _resolve_output_path(out_file)
        data, sr = sf.read(str(out_path), dtype="float32", always_2d=True)
        name = out_path.stem.lower()
        if "drum" in name:
            results["drums"] = data
        elif "bass" in name:
            results["bass"] = data
        elif "other" in name:
            results["other"] = data
        # Skip vocals from demucs (we already have better ones from BS-RoFormer)

    logger.info(f"Separation complete. Stems: {list(results.keys())}")
    return results


def apply_operations(
    original_audio: np.ndarray,
    stems: dict[str, np.ndarray],
    sample_rate: int,
    operations: list[StemOperation],
) -> np.ndarray:
    """
    Apply stem operations to the audio.

    For overlapping time ranges:
    - Multiple 'isolate' operations are combined (sum of isolated stems)
    - 'remove' operations subtract the stem from whatever remains

    Operations are processed per-sample by building a timeline of boundaries.
    """
    if not operations:
        return original_audio.copy()

    result = original_audio.copy()
    length = result.shape[0]

    # Collect all unique time boundaries
    boundaries: set[float] = set()
    for op in operations:
        boundaries.add(op.time_range.start)
        boundaries.add(op.time_range.end)

    sorted_boundaries = sorted(boundaries)

    # Process each segment between boundaries
    for i in range(len(sorted_boundaries) - 1):
        seg_start = sorted_boundaries[i]
        seg_end = sorted_boundaries[i + 1]

        # Find all operations active in this segment
        active_ops = [
            op for op in operations
            if op.time_range.start <= seg_start and op.time_range.end >= seg_end
        ]
        if not active_ops:
            continue

        # Separate into remove and isolate operations
        remove_ops = [op for op in active_ops if op.action == "remove"]
        isolate_ops = [op for op in active_ops if op.action == "isolate"]

        start_sample = int(seg_start * sample_rate)
        end_sample = min(int(seg_end * sample_rate), length)
        if start_sample >= end_sample:
            continue

        if isolate_ops:
            # Sum all isolated stems together
            new_slice = np.zeros_like(result[start_sample:end_sample])
            isolated_stems: set[str] = set()
            for op in isolate_ops:
                stem_name = op.stem.value
                if stem_name == "instrumental":
                    isolated_stems.update(["drums", "bass", "other"])
                else:
                    isolated_stems.add(stem_name)

            for stem_name in isolated_stems:
                if stem_name in stems:
                    stem_data = stems[stem_name]
                    s_end = min(end_sample, stem_data.shape[0])
                    if start_sample < s_end:
                        new_slice[:s_end - start_sample] += stem_data[start_sample:s_end]

            # Apply any removes on top (subtract from isolated mix)
            for op in remove_ops:
                stem_name = op.stem.value
                if stem_name in stems:
                    stem_data = stems[stem_name]
                    s_end = min(end_sample, stem_data.shape[0])
                    if start_sample < s_end:
                        new_slice[:s_end - start_sample] -= stem_data[start_sample:s_end]

            new_slice = np.clip(new_slice, -1.0, 1.0)
            result[start_sample:end_sample] = new_slice[:end_sample - start_sample]
        else:
            # Only removes: subtract each stem from the current mix
            segment = result[start_sample:end_sample].copy()
            for op in remove_ops:
                stem_name = op.stem.value
                if stem_name in stems:
                    stem_data = stems[stem_name]
                    s_end = min(end_sample, stem_data.shape[0])
                    if start_sample < s_end:
                        segment[:s_end - start_sample] -= stem_data[start_sample:s_end]

            segment = np.clip(segment, -1.0, 1.0)
            result[start_sample:end_sample] = segment

    return result


# In-memory job store (replace with DB in production)
_jobs: dict[str, ProcessingJob] = {}
_separation_jobs: dict[str, SeparationJob] = {}
_stem_files: dict[str, dict[str, Path]] = {}  # track_id -> {stem_name: file_path}
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


# ---------------------------------------------------------------------------
# Stem separation (saves individual stems for client-side preview)
# ---------------------------------------------------------------------------

def get_stem_files(track_id: str) -> dict[str, Path] | None:
    return _stem_files.get(track_id)


def get_separation_job(job_id: str) -> SeparationJob | None:
    return _separation_jobs.get(job_id)


def create_separation_job(track_id: str, track_path: Path, quality: str = "high") -> SeparationJob:
    """Create and start an async stem separation job."""
    job_id = str(uuid.uuid4())
    job = SeparationJob(
        job_id=job_id,
        track_id=track_id,
        status=ProcessingStatus.PENDING,
    )
    _separation_jobs[job_id] = job
    _executor.submit(_run_separation, job_id, track_id, track_path, quality)
    return job


def _run_separation(job_id: str, track_id: str, track_path: Path, quality: str = "high"):
    """Background job: separate stems and save each as a WAV file."""
    job = _separation_jobs[job_id]
    try:
        job.status = ProcessingStatus.SEPARATING
        job.progress = 5

        def _update_progress(pct: int):
            job.progress = min(pct, 95)

        # Patch tqdm in all modules that use it so we capture iteration progress
        with patch("audio_separator.separator.architectures.mdxc_separator.tqdm", _ProgressTqdm), \
             patch("audio_separator.separator.uvr_lib_v5.demucs.apply.tqdm.tqdm", _ProgressTqdm), \
             patch("tqdm.tqdm", _ProgressTqdm):
            stems = separate_track(track_path, progress_callback=_update_progress, quality=quality)

        # Get sample rate from original file
        info = sf.info(str(track_path))
        sample_rate = info.samplerate

        # Save each stem as a 16-bit WAV for client preview
        stem_files: dict[str, Path] = {}
        for stem_name, audio_data in stems.items():
            stem_path = settings.output_dir / f"{track_id}_{stem_name}.wav"
            sf.write(str(stem_path), audio_data, sample_rate, subtype="PCM_16")
            stem_files[stem_name] = stem_path

        _stem_files[track_id] = stem_files
        job.stems = list(stem_files.keys())
        job.status = ProcessingStatus.COMPLETE
        job.progress = 100
        logger.info(f"Separation job {job_id} complete. Stems: {job.stems}")

    except Exception as e:
        logger.exception(f"Separation job {job_id} failed")
        job.status = ProcessingStatus.FAILED
        job.error = str(e)
