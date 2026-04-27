import { useState, useCallback, useRef, useEffect } from "react";
import FileUpload from "./components/FileUpload";
import WaveformView from "./components/WaveformView";
import TimelineSelector, { StemControls } from "./components/StemControls";
import OperationsList from "./components/OperationsList";
import ProcessingStatus from "./components/ProcessingStatus";
import {
  uploadTrack,
  startProcessing,
  getJobStatus,
  getDownloadUrl,
} from "./services/api";
import type {
  TrackInfo,
  StemType,
  TimeRange,
  StemOperation,
  ProcessingJob,
} from "./types";

export default function App() {
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [timeRange, setTimeRange] = useState<TimeRange>({ start: 0, end: 0 });
  const [operations, setOperations] = useState<StemOperation[]>([]);
  const [activeStem, setActiveStem] = useState<StemType | null>(null);
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFileSelected = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const trackInfo = await uploadTrack(file);
      setTrack(trackInfo);
      // Create a local URL for waveform display
      setAudioUrl(URL.createObjectURL(file));
      setTimeRange({ start: 0, end: trackInfo.duration });
      setOperations([]);
      setJob(null);
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleStemSelect = useCallback(
    (stem: StemType, action: "remove" | "isolate") => {
      setActiveStem(stem);
      setOperations((prev) => [
        ...prev,
        { stem, time_range: timeRange, action },
      ]);
    },
    [timeRange]
  );

  const handleRemoveOperation = useCallback((index: number) => {
    setOperations((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleProcess = useCallback(async () => {
    if (!track || operations.length === 0) return;
    setIsProcessing(true);

    try {
      const newJob = await startProcessing(track.track_id, operations, "wav");
      setJob(newJob);

      // Poll for status updates
      pollRef.current = setInterval(async () => {
        try {
          const updated = await getJobStatus(newJob.job_id);
          setJob(updated);
          if (updated.status === "complete" || updated.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setIsProcessing(false);
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
          setIsProcessing(false);
        }
      }, 1500);
    } catch (err) {
      console.error("Processing failed:", err);
      setIsProcessing(false);
    }
  }, [track, operations]);

  const handleDownload = useCallback(() => {
    if (job?.job_id) {
      window.open(getDownloadUrl(job.job_id), "_blank");
    }
  }, [job]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-stem-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="6" fill="#7c3aed" />
            <path
              d="M8 22V14M12 22V10M16 22V6M20 22V10M24 22V14"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <h1 className="text-xl font-bold tracking-tight">Stemizer</h1>
          <span className="text-xs text-gray-500 bg-stem-surface border border-stem-border px-2 py-0.5 rounded-full ml-1">
            v0.1
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Upload Section */}
        {!track && (
          <FileUpload
            onFileSelected={handleFileSelected}
            isUploading={isUploading}
          />
        )}

        {/* Track loaded — show editor */}
        {track && audioUrl && (
          <>
            {/* Track info bar */}
            <div className="card flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-lg">{track.filename}</h2>
                <p className="text-sm text-gray-500">
                  {track.format.toUpperCase()} · {track.sample_rate}Hz ·{" "}
                  {track.channels === 2 ? "Stereo" : "Mono"} ·{" "}
                  {(track.file_size_bytes / (1024 * 1024)).toFixed(1)}MB
                </p>
              </div>
              <button
                onClick={() => {
                  setTrack(null);
                  setAudioUrl(null);
                  setOperations([]);
                  setJob(null);
                }}
                className="text-sm text-gray-500 hover:text-white transition-colors"
              >
                Upload Different Track
              </button>
            </div>

            {/* Waveform */}
            <WaveformView
              audioUrl={audioUrl}
              onReady={(dur) => {
                setDuration(dur);
                setTimeRange({ start: 0, end: dur });
              }}
            />

            {/* Controls */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TimelineSelector
                duration={duration}
                onRangeSelect={setTimeRange}
              />
              <StemControls
                onStemSelect={handleStemSelect}
                activeStem={activeStem}
              />
            </div>

            {/* Operations Queue */}
            <OperationsList
              operations={operations}
              onRemove={handleRemoveOperation}
            />

            {/* Process Button */}
            {operations.length > 0 && !job && (
              <button
                onClick={handleProcess}
                disabled={isProcessing}
                className="btn-primary w-full py-4 text-lg font-semibold disabled:opacity-50"
              >
                {isProcessing ? "Starting..." : `Process Track (${operations.length} operation${operations.length > 1 ? "s" : ""})`}
              </button>
            )}

            {/* Processing Status */}
            {job && (
              <ProcessingStatus job={job} onDownload={handleDownload} />
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-stem-border mt-16">
        <div className="max-w-6xl mx-auto px-6 py-4 text-center text-xs text-gray-600">
          Stemizer — AI-powered stem separation for electronic music · Powered by Demucs
        </div>
      </footer>
    </div>
  );
}
