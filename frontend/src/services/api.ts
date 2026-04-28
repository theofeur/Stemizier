import axios from "axios";
import type { TrackInfo, ProcessingJob, StemOperation, SeparationJob } from "../types";

const api = axios.create({
  baseURL: "/api",
});

export async function uploadTrack(
  file: File,
  onProgress?: (progress: number) => void
): Promise<TrackInfo> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post<TrackInfo>("/tracks/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });
  return data;
}

export async function getTrackInfo(trackId: string): Promise<TrackInfo> {
  const { data } = await api.get<TrackInfo>(`/tracks/${trackId}`);
  return data;
}

export async function startSeparation(trackId: string, quality: string = "high"): Promise<SeparationJob> {
  const { data } = await api.post<SeparationJob>(`/tracks/${trackId}/separate`, { quality });
  return data;
}

export async function getSeparationStatus(jobId: string): Promise<SeparationJob> {
  const { data } = await api.get<SeparationJob>(`/tracks/separation-jobs/${jobId}`);
  return data;
}

export function getStemAudioUrl(trackId: string, stemName: string): string {
  return `/api/tracks/${trackId}/stems/${stemName}`;
}

export async function startProcessing(
  trackId: string,
  operations: StemOperation[],
  outputFormat: "wav" | "mp3" = "wav"
): Promise<ProcessingJob> {
  const { data } = await api.post<ProcessingJob>("/process", {
    track_id: trackId,
    operations,
    output_format: outputFormat,
  });
  return data;
}

export async function getJobStatus(jobId: string): Promise<ProcessingJob> {
  const { data } = await api.get<ProcessingJob>(`/process/jobs/${jobId}`);
  return data;
}

export function getDownloadUrl(jobId: string): string {
  return `/api/process/jobs/${jobId}/download`;
}
