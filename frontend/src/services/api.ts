import axios from "axios";
import type { TrackInfo, ProcessingJob, StemOperation } from "../types";

const api = axios.create({
  baseURL: "/api",
});

export async function uploadTrack(file: File): Promise<TrackInfo> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post<TrackInfo>("/tracks/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function getTrackInfo(trackId: string): Promise<TrackInfo> {
  const { data } = await api.get<TrackInfo>(`/tracks/${trackId}`);
  return data;
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
