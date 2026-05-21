export type StemType = "vocals" | "drums" | "bass" | "guitar" | "piano" | "other" | "instrumental";

export type EditorMode = "stems" | "edit";

export interface TimeRange {
  start: number;
  end: number;
}

/** A segment of the original audio used in the edit timeline */
export interface AudioRegion {
  sourceStart: number; // start time in the original audio (seconds)
  sourceEnd: number;   // end time in the original audio (seconds)
}

/** Clipboard for edit mode — stores copied audio regions */
export interface EditClipboard {
  regions: AudioRegion[];
  duration: number; // total duration of clipboard content
}

export interface StemOperation {
  stem: StemType;
  time_range: TimeRange;
  action: "remove" | "isolate";
}

export interface TrackInfo {
  track_id: string;
  filename: string;
  duration: number;
  sample_rate: number;
  channels: number;
  format: string;
  file_size_bytes: number;
  bpm: number;
}

export interface ProcessingJob {
  job_id: string;
  track_id: string;
  status: "pending" | "separating" | "processing" | "complete" | "failed";
  progress: number;
  operations: StemOperation[];
  output_file: string | null;
  error: string | null;
}

export type QualityPreset = "fast" | "balanced" | "high";

export type OutputFormat = "wav" | "flac" | "mp3" | "ogg" | "aac";

export const OUTPUT_FORMATS: Record<OutputFormat, { label: string; description: string }> = {
  wav: { label: "WAV", description: "Lossless · Uncompressed · Full quality" },
  flac: { label: "FLAC", description: "Lossless · Compressed · ~50% smaller than WAV" },
  mp3: { label: "MP3", description: "320kbps · Cuts above ~20kHz · Universal compatibility" },
  ogg: { label: "OGG Vorbis", description: "Max quality · Full bandwidth · Smaller than WAV" },
  aac: { label: "AAC (M4A)", description: "256kbps · Full bandwidth · Apple/streaming" },
};

export interface SeparationJob {
  job_id: string;
  track_id: string;
  status: "pending" | "separating" | "complete" | "failed";
  progress: number;
  stems: string[];
  error: string | null;
}

export const QUALITY_PRESETS: Record<QualityPreset, { label: string; description: string }> = {
  fast: { label: "Fast", description: "~1-2 min · Good quality" },
  balanced: { label: "Balanced", description: "~3-5 min · Great quality" },
  high: { label: "High Quality", description: "~8-15 min · Best quality" },
};

export const STEM_COLORS: Record<StemType, string> = {
  vocals: "#f43f5e",
  drums: "#f97316",
  bass: "#3b82f6",
  guitar: "#10b981",
  piano: "#eab308",
  other: "#a855f7",
  instrumental: "#22c55e",
};

export const STEM_LABELS: Record<StemType, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  guitar: "Guitar",
  piano: "Piano / Keys",
  other: "Other / Synths / Pads",
  instrumental: "Instrumental",
};
