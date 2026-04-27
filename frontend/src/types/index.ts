export type StemType = "vocals" | "drums" | "bass" | "guitar" | "piano" | "other";

export interface TimeRange {
  start: number;
  end: number;
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

export const STEM_COLORS: Record<StemType, string> = {
  vocals: "#f43f5e",
  drums: "#f97316",
  bass: "#3b82f6",
  guitar: "#22c55e",
  piano: "#eab308",
  other: "#a855f7",
};

export const STEM_LABELS: Record<StemType, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  guitar: "Guitar / Synth Lead",
  piano: "Piano / Keys",
  other: "Other / Pads",
};
