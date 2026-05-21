"""Audio processing utilities — loading, slicing, recombining."""

import numpy as np
import soundfile as sf
from pathlib import Path


def get_audio_info(file_path: Path) -> dict:
    """Extract metadata from an audio file without loading all samples."""
    info = sf.info(str(file_path))
    return {
        "duration": info.duration,
        "sample_rate": info.samplerate,
        "channels": info.channels,
        "format": info.format,
        "subtype": info.subtype,
        "frames": info.frames,
    }


def load_audio(file_path: Path, sample_rate: int | None = None) -> tuple[np.ndarray, int]:
    """
    Load audio file preserving full quality.
    Returns (audio_data, sample_rate) where audio_data shape is (samples, channels).
    """
    data, sr = sf.read(str(file_path), dtype="float32", always_2d=True)
    if sample_rate and sr != sample_rate:
        # Resample only if explicitly requested — default is to preserve original
        import librosa
        data = librosa.resample(data.T, orig_sr=sr, target_sr=sample_rate).T
        sr = sample_rate
    return data, sr


def save_audio(data: np.ndarray, sample_rate: int, output_path: Path, format: str = "wav"):
    """Save audio data to file, preserving quality."""
    if format == "wav":
        sf.write(str(output_path), data, sample_rate, subtype="PCM_24")
    elif format == "flac":
        # Lossless compression — same quality as WAV, smaller file
        sf.write(str(output_path), data, sample_rate, format="FLAC")
    elif format == "mp3":
        # 320kbps MP3 with no lowpass filter to preserve full spectrum
        import subprocess, tempfile
        temp_wav = output_path.with_suffix(".tmp.wav")
        sf.write(str(temp_wav), data, sample_rate, subtype="PCM_24")
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(temp_wav),
             "-codec:a", "libmp3lame", "-b:a", "320k",
             "-cutoff", str(sample_rate // 2),  # No lowpass — preserve full bandwidth
             str(output_path)],
            check=True, capture_output=True,
        )
        temp_wav.unlink()
    elif format == "ogg":
        # OGG Vorbis quality 10 (max) with no bandwidth cutoff
        import subprocess
        temp_wav = output_path.with_suffix(".tmp.wav")
        sf.write(str(temp_wav), data, sample_rate, subtype="PCM_24")
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(temp_wav),
             "-codec:a", "libvorbis", "-q:a", "10",
             "-cutoff", str(sample_rate // 2),
             str(output_path)],
            check=True, capture_output=True,
        )
        temp_wav.unlink()
    elif format == "aac":
        # AAC in M4A container — 256kbps VBR, full bandwidth
        import subprocess
        temp_wav = output_path.with_suffix(".tmp.wav")
        sf.write(str(temp_wav), data, sample_rate, subtype="PCM_24")
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(temp_wav),
             "-codec:a", "aac", "-b:a", "256k",
             "-cutoff", str(sample_rate // 2),
             str(output_path)],
            check=True, capture_output=True,
        )
        temp_wav.unlink()
    else:
        raise ValueError(f"Unsupported output format: {format}")


def slice_audio(
    data: np.ndarray, sample_rate: int, start_sec: float, end_sec: float
) -> np.ndarray:
    """Extract a time range from audio data."""
    start_sample = int(start_sec * sample_rate)
    end_sample = int(end_sec * sample_rate)
    end_sample = min(end_sample, len(data))
    return data[start_sample:end_sample]


def replace_segment(
    original: np.ndarray,
    replacement: np.ndarray,
    sample_rate: int,
    start_sec: float,
) -> np.ndarray:
    """Replace a segment of the original audio with the replacement starting at start_sec."""
    start_sample = int(start_sec * sample_rate)
    end_sample = start_sample + len(replacement)
    result = original.copy()
    result[start_sample:end_sample] = replacement
    return result


def detect_bpm(file_path: Path) -> float:
    """Detect BPM using librosa's tempo estimation."""
    import librosa
    # Load first 120s mono for speed
    y, sr = librosa.load(str(file_path), sr=None, mono=True, duration=120)
    # Use tempo() with a sensible prior and aggregate for better accuracy
    tempo = librosa.feature.tempo(y=y, sr=sr, prior=None, aggregate=np.median)
    bpm = float(np.asarray(tempo).flat[0])
    # Correct half/double tempo: keep BPM in 70-180 range
    while bpm < 70 and bpm > 0:
        bpm *= 2
    while bpm > 180:
        bpm /= 2
    return round(bpm, 1)


def convert_to_wav(input_path: Path, output_path: Path) -> Path:
    """Convert any supported audio format to WAV for processing."""
    if input_path.suffix.lower() == ".wav":
        return input_path
    from pydub import AudioSegment
    audio = AudioSegment.from_file(str(input_path))
    audio.export(str(output_path), format="wav")
    return output_path
