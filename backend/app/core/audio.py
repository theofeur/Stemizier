"""Audio processing utilities — loading, slicing, recombining."""

import numpy as np
import soundfile as sf
from pathlib import Path
from pydub import AudioSegment


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
    elif format == "mp3":
        # Save as high-quality WAV first, then convert to 320kbps MP3
        temp_wav = output_path.with_suffix(".tmp.wav")
        sf.write(str(temp_wav), data, sample_rate, subtype="PCM_24")
        audio = AudioSegment.from_wav(str(temp_wav))
        audio.export(str(output_path), format="mp3", bitrate="320k")
        temp_wav.unlink()


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


def convert_to_wav(input_path: Path, output_path: Path) -> Path:
    """Convert any supported audio format to WAV for processing."""
    if input_path.suffix.lower() == ".wav":
        return input_path
    audio = AudioSegment.from_file(str(input_path))
    audio.export(str(output_path), format="wav")
    return output_path
