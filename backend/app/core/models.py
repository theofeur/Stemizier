from enum import Enum
from pydantic import BaseModel, Field


class StemType(str, Enum):
    VOCALS = "vocals"
    DRUMS = "drums"
    BASS = "bass"
    OTHER = "other"
    INSTRUMENTAL = "instrumental"


class ProcessingStatus(str, Enum):
    PENDING = "pending"
    SEPARATING = "separating"
    PROCESSING = "processing"
    COMPLETE = "complete"
    FAILED = "failed"


class TimeRange(BaseModel):
    start: float = Field(..., ge=0, description="Start time in seconds")
    end: float = Field(..., gt=0, description="End time in seconds")


class StemOperation(BaseModel):
    """Defines a stem removal/isolation operation on a time range."""
    stem: StemType
    time_range: TimeRange
    action: str = Field(
        "remove",
        pattern="^(remove|isolate)$",
        description="'remove' to strip this stem, 'isolate' to keep only this stem",
    )


class ProcessRequest(BaseModel):
    """Request to process an uploaded track with stem operations."""
    track_id: str
    operations: list[StemOperation] = Field(
        ..., min_length=1, description="List of stem operations to apply"
    )
    output_format: str = Field("wav", pattern="^(wav|mp3)$")


class TrackInfo(BaseModel):
    track_id: str
    filename: str
    duration: float
    sample_rate: int
    channels: int
    format: str
    file_size_bytes: int


class ProcessingJob(BaseModel):
    job_id: str
    track_id: str
    status: ProcessingStatus
    progress: float = Field(0.0, ge=0, le=100)
    operations: list[StemOperation]
    output_file: str | None = None
    error: str | None = None
