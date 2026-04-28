import { useState, useCallback, useRef, useEffect } from "react";
import FileUpload from "./components/FileUpload";
import WaveformEditor from "./components/WaveformEditor";
import StemControls from "./components/StemControls";
import OperationsList from "./components/OperationsList";
import ProcessingStatus from "./components/ProcessingStatus";
import { AudioEngine } from "./lib/AudioEngine";
import {
  uploadTrack,
  startSeparation,
  getSeparationStatus,
  getStemAudioUrl,
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
  SeparationJob,
} from "./types";

const STEM_DISPLAY_ORDER: StemType[] = ["vocals", "drums", "bass", "other"];

export default function App() {
  // Track state
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Separation state
  const [sepJob, setSepJob] = useState<SeparationJob | null>(null);
  const [stemsReady, setStemsReady] = useState(false);
  const [, setStemsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  // Unified loading progress
  const [loadingPhase, setLoadingPhase] = useState<
    "idle" | "uploading" | "analyzing" | "separating" | "loading-stems" | "done"
  >("idle");
  const [loadingProgress, setLoadingProgress] = useState(0);

  // Audio engine
  const engineRef = useRef<AudioEngine | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Peaks for waveform
  const [originalPeaks, setOriginalPeaks] = useState<Float32Array | null>(null);
  const [stemPeaks, setStemPeaks] = useState<Record<string, Float32Array> | null>(null);

  // Region & operations
  const [region, setRegion] = useState<TimeRange | null>(null);
  const [operations, setOperations] = useState<StemOperation[]>([]);

  // Export job
  const [exportJob, setExportJob] = useState<ProcessingJob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggerSeparationRef = useRef<(trackId: string) => void>(() => {});

  /* ── Audio engine lifecycle ──────────────────────────────────────── */

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
    };
  }, []);

  /* ── Upload handler ──────────────────────────────────────────────── */

  const handleFileSelected = useCallback(async (file: File) => {
    setIsUploading(true);
    setLoadingPhase("uploading");
    setLoadingProgress(0);
    try {
      const trackInfo = await uploadTrack(file, (progress) => {
        setLoadingProgress(progress);
      });
      setTrack(trackInfo);
      setDuration(trackInfo.duration);

      setLoadingPhase("analyzing");
      setLoadingProgress(0);

      const url = URL.createObjectURL(file);

      // Create audio engine and load original
      const engine = new AudioEngine();
      engine.onTimeUpdate = (t) => setCurrentTime(t);
      engine.onPlayStateChange = (p) => setIsPlaying(p);
      await engine.loadOriginal(url);
      engineRef.current = engine;

      // Extract original peaks for initial waveform
      const peaks = engine.getOriginalPeaks(800);
      setOriginalPeaks(peaks);
      setDuration(engine.duration);

      // Reset
      setOperations([]);
      setExportJob(null);
      setRegion(null);
      setStemPeaks(null);
      setStemsReady(false);
      setSepJob(null);

      setIsUploading(false);

      // Auto-start separation
      triggerSeparationRef.current(trackInfo.track_id);
    } catch (err) {
      console.error("Upload failed:", err);
      setLoadingPhase("idle");
      setLoadingProgress(0);
      setIsUploading(false);
    }
  }, []);

  /* ── Separation ──────────────────────────────────────────────────── */

  const triggerSeparation = useCallback(async (trackId: string) => {
    try {
      setLoadingPhase("separating");
      setLoadingProgress(0);
      const job = await startSeparation(trackId);
      setSepJob(job);

      // Poll for completion
      const poll = setInterval(async () => {
        try {
          const updated = await getSeparationStatus(job.job_id);
          setSepJob(updated);
          setLoadingProgress(updated.progress);
          if (updated.status === "complete") {
            clearInterval(poll);
            loadStems(trackId, updated.stems);
          } else if (updated.status === "failed") {
            clearInterval(poll);
            setLoadingPhase("idle");
          }
        } catch {
          clearInterval(poll);
          setLoadingPhase("idle");
        }
      }, 2000);
    } catch (err) {
      console.error("Separation failed:", err);
      setLoadingPhase("idle");
    }
  }, []);

  triggerSeparationRef.current = triggerSeparation;

  const loadStems = useCallback(
    async (trackId: string, stemNames: string[]) => {
      const engine = engineRef.current;
      if (!engine) return;

      setStemsLoading(true);
      setLoadingPhase("loading-stems");
      setLoadingProgress(0);
      try {
        for (let i = 0; i < stemNames.length; i++) {
          const name = stemNames[i]!;
          setLoadingMessage(`Loading ${name}...`);
          setLoadingProgress(Math.round((i / stemNames.length) * 100));
          const url = getStemAudioUrl(trackId, name);
          await engine.loadStem(name, url);
        }

        // Extract peaks for colored waveform
        const peaks: Record<string, Float32Array> = {};
        for (const name of STEM_DISPLAY_ORDER) {
          if (stemNames.includes(name)) {
            peaks[name] = engine.getStemPeaks(name, 800);
          }
        }
        setStemPeaks(peaks);
        setStemsReady(true);
        setLoadingMessage("");
        setLoadingPhase("done");
        setLoadingProgress(100);
      } catch (err) {
        console.error("Failed to load stems:", err);
        setLoadingMessage("Failed to load stems");
        setLoadingPhase("idle");
      } finally {
        setStemsLoading(false);
      }
    },
    []
  );

  /* ── Playback ────────────────────────────────────────────────────── */

  const handlePlayPause = useCallback(() => {
    engineRef.current?.playPause();
  }, []);

  const handleSeek = useCallback((time: number) => {
    engineRef.current?.seek(time);
  }, []);

  /* ── Operations ──────────────────────────────────────────────────── */

  const handleStemAction = useCallback(
    (stem: StemType, action: "remove" | "isolate") => {
      if (!region) return;
      const newOp: StemOperation = {
        stem,
        time_range: { start: region.start, end: region.end },
        action,
      };
      setOperations((prev) => {
        const updated = [...prev, newOp];
        engineRef.current?.applyOperations(updated);
        return updated;
      });
    },
    [region]
  );

  const handleRemoveOperation = useCallback((index: number) => {
    setOperations((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      engineRef.current?.applyOperations(updated);
      return updated;
    });
  }, []);

  /* ── Export ───────────────────────────────────────────────────────── */

  const handleExport = useCallback(async () => {
    if (!track || operations.length === 0) return;
    setIsProcessing(true);

    try {
      const newJob = await startProcessing(track.track_id, operations, "wav");
      setExportJob(newJob);

      pollRef.current = setInterval(async () => {
        try {
          const updated = await getJobStatus(newJob.job_id);
          setExportJob(updated);
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
      console.error("Export failed:", err);
      setIsProcessing(false);
    }
  }, [track, operations]);

  const handleDownload = useCallback(() => {
    if (exportJob?.job_id) {
      window.open(getDownloadUrl(exportJob.job_id), "_blank");
    }
  }, [exportJob]);

  /* ── Reset ───────────────────────────────────────────────────────── */

  const handleReset = useCallback(() => {
    engineRef.current?.dispose();
    engineRef.current = null;
    setTrack(null);
    setOperations([]);
    setExportJob(null);
    setRegion(null);
    setOriginalPeaks(null);
    setStemPeaks(null);
    setStemsReady(false);
    setSepJob(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setLoadingPhase("idle");
    setLoadingProgress(0);
  }, []);

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
            v0.2
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Upload Section */}
        {!track && !isUploading && loadingPhase === "idle" && (
          <FileUpload
            onFileSelected={handleFileSelected}
            isUploading={isUploading}
          />
        )}

        {/* Upload progress (before track is set) */}
        {!track && loadingPhase === "uploading" && (
          <div className="card">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-5 h-5 border-2 border-stem-accent/30 border-t-stem-accent rounded-full animate-spin" />
              <div className="flex-1">
                <span className="font-medium text-blue-400">Uploading track...</span>
                <p className="text-xs text-gray-500 mt-0.5">Sending file to server</p>
              </div>
            </div>
            <div className="w-full h-3 bg-stem-bg rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-stem-accent to-purple-400 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-xs text-gray-500">Step 1/4</span>
              <span className="text-xs text-gray-500">{loadingProgress}%</span>
            </div>
          </div>
        )}

        {/* Track loaded */}
        {track && (
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
                onClick={handleReset}
                className="text-sm text-gray-500 hover:text-white transition-colors"
              >
                Upload Different Track
              </button>
            </div>

            {/* Waveform Editor */}
            <WaveformEditor
              originalPeaks={originalPeaks}
              stemPeaks={stemPeaks}
              duration={duration}
              currentTime={currentTime}
              isPlaying={isPlaying}
              region={region}
              onRegionChange={setRegion}
              onSeek={handleSeek}
              onPlayPause={handlePlayPause}
              operations={operations}
            />

            {/* Loading Progress Bar */}
            {loadingPhase !== "idle" && loadingPhase !== "done" && (
              <div className="card">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-5 h-5 border-2 border-stem-accent/30 border-t-stem-accent rounded-full animate-spin" />
                  <div className="flex-1">
                    <span className="font-medium text-blue-400">
                      {loadingPhase === "uploading" && "Uploading track..."}
                      {loadingPhase === "analyzing" && "Analyzing audio..."}
                      {loadingPhase === "separating" && "Separating stems with AI..."}
                      {loadingPhase === "loading-stems" && (loadingMessage || "Loading stems...")}
                    </span>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {loadingPhase === "uploading" && "Sending file to server"}
                      {loadingPhase === "analyzing" && "Preparing waveform data"}
                      {loadingPhase === "separating" && "This may take a minute depending on track length"}
                      {loadingPhase === "loading-stems" && "Downloading separated audio"}
                    </p>
                  </div>
                </div>
                {/* Full progress bar */}
                <div className="w-full h-3 bg-stem-bg rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-stem-accent to-purple-400 rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${loadingProgress}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-xs text-gray-500">
                    {loadingPhase === "uploading" && "Step 1/4"}
                    {loadingPhase === "analyzing" && "Step 2/4"}
                    {loadingPhase === "separating" && "Step 3/4"}
                    {loadingPhase === "loading-stems" && "Step 4/4"}
                  </span>
                  <span className="text-xs text-gray-500">{loadingProgress}%</span>
                </div>
                {sepJob?.status === "failed" && sepJob.error && (
                  <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3 mt-3">
                    {sepJob.error}
                  </p>
                )}
              </div>
            )}

            {/* Stem controls (only after separation) */}
            {stemsReady && (
              <>
                <StemControls
                  onStemAction={handleStemAction}
                  region={region}
                  disabled={!stemsReady}
                />

                {/* Operations Queue */}
                <OperationsList
                  operations={operations}
                  onRemove={handleRemoveOperation}
                />

                {/* Export Button */}
                {operations.length > 0 && !exportJob && (
                  <button
                    onClick={handleExport}
                    disabled={isProcessing}
                    className="btn-primary w-full py-4 text-lg font-semibold disabled:opacity-50"
                  >
                    {isProcessing
                      ? "Starting..."
                      : `Export Track (${operations.length} operation${operations.length > 1 ? "s" : ""})`}
                  </button>
                )}

                {/* Export Status */}
                {exportJob && (
                  <ProcessingStatus job={exportJob} onDownload={handleDownload} />
                )}
              </>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-stem-border mt-16">
        <div className="max-w-6xl mx-auto px-6 py-4 text-center text-xs text-gray-600">
          Stemizer — AI-powered stem separation for electronic music · Powered
          by BS-RoFormer &amp; Demucs
        </div>
      </footer>
    </div>
  );
}
