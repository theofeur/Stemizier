import { useState, useCallback, useRef, useEffect } from "react";
import FileUpload from "./components/FileUpload";
import WaveformEditor from "./components/WaveformEditor";
import StemControls from "./components/StemControls";
import EditControls from "./components/EditControls";
import OperationsList from "./components/OperationsList";
import ProcessingStatus from "./components/ProcessingStatus";
import BpmControls from "./components/BpmControls";
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
  QualityPreset,
  OutputFormat,
  EditorMode,
  AudioRegion,
  EditClipboard,
} from "./types";
import { QUALITY_PRESETS, OUTPUT_FORMATS } from "./types";

const STEM_DISPLAY_ORDER: StemType[] = ["vocals", "drums", "bass", "guitar", "piano", "other"];

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

  // Quality preset
  const [quality, setQuality] = useState<QualityPreset>("high");

  // Output format
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("wav");

  // Export range option
  const [exportSelectionOnly, setExportSelectionOnly] = useState(false);

  // BPM state
  const [bpm, setBpm] = useState(0);
  const [masterTempo, setMasterTempo] = useState(false);

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

  // Edit timeline (for edit mode — Audacity-like)
  const [editTimeline, setEditTimeline] = useState<AudioRegion[] | null>(null);
  const [editClipboard, setEditClipboard] = useState<EditClipboard | null>(null);

  // Editor mode
  const [editorMode, setEditorMode] = useState<EditorMode>("stems");
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
      setBpm(trackInfo.bpm || 0);

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
      const job = await startSeparation(trackId, quality);
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
      }, 1000);
    } catch (err) {
      console.error("Separation failed:", err);
      setLoadingPhase("idle");
    }
  }, [quality]);

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

  /* ── BPM ──────────────────────────────────────────────────────────── */

  const handleBpmChange = useCallback((newBpm: number) => {
    setBpm(newBpm);
    if (track && track.bpm > 0) {
      engineRef.current?.setTempoRatio(newBpm / track.bpm);
    }
  }, [track]);

  const handleMasterTempoChange = useCallback((enabled: boolean) => {
    setMasterTempo(enabled);
    engineRef.current?.setMasterTempo(enabled);
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

  /* ── Edit Timeline (Audacity-like) ──────────────────────────────── */

  /** Get the current timeline (or create default from original duration) */
  const getTimeline = useCallback((): AudioRegion[] => {
    if (editTimeline) return editTimeline;
    return [{ sourceStart: 0, sourceEnd: duration }];
  }, [editTimeline, duration]);

  /** Extract sub-regions from the timeline at the given edited-time range */
  const extractRegions = useCallback((start: number, end: number): AudioRegion[] => {
    const timeline = getTimeline();
    const result: AudioRegion[] = [];
    let elapsed = 0;
    for (const region of timeline) {
      const regionDur = region.sourceEnd - region.sourceStart;
      const regionEnd = elapsed + regionDur;

      if (regionEnd <= start) { elapsed = regionEnd; continue; }
      if (elapsed >= end) break;

      const clipStart = Math.max(0, start - elapsed);
      const clipEnd = Math.min(regionDur, end - elapsed);
      result.push({
        sourceStart: region.sourceStart + clipStart,
        sourceEnd: region.sourceStart + clipEnd,
      });
      elapsed = regionEnd;
    }
    return result;
  }, [getTimeline]);

  /** Remove a range from the timeline (returns new timeline) */
  const removeFromTimeline = useCallback((start: number, end: number): AudioRegion[] => {
    const timeline = getTimeline();
    const result: AudioRegion[] = [];
    let elapsed = 0;
    for (const region of timeline) {
      const regionDur = region.sourceEnd - region.sourceStart;
      const regionEnd = elapsed + regionDur;

      if (regionEnd <= start || elapsed >= end) {
        // Entirely outside the cut range — keep as-is
        result.push(region);
      } else {
        // Partially or fully inside the cut range
        if (elapsed < start) {
          // Keep the part before the cut
          result.push({ sourceStart: region.sourceStart, sourceEnd: region.sourceStart + (start - elapsed) });
        }
        if (regionEnd > end) {
          // Keep the part after the cut
          result.push({ sourceStart: region.sourceStart + (end - elapsed), sourceEnd: region.sourceEnd });
        }
      }
      elapsed = regionEnd;
    }
    return result;
  }, [getTimeline]);

  /** Insert regions at a position in the timeline */
  const insertIntoTimeline = useCallback((position: number, regions: AudioRegion[]): AudioRegion[] => {
    const timeline = getTimeline();
    const result: AudioRegion[] = [];
    let elapsed = 0;
    let inserted = false;

    for (const region of timeline) {
      const regionDur = region.sourceEnd - region.sourceStart;

      if (!inserted && elapsed + regionDur >= position) {
        // Split this region and insert
        const splitPoint = position - elapsed;
        if (splitPoint > 0.001) {
          result.push({ sourceStart: region.sourceStart, sourceEnd: region.sourceStart + splitPoint });
        }
        result.push(...regions);
        if (splitPoint < regionDur - 0.001) {
          result.push({ sourceStart: region.sourceStart + splitPoint, sourceEnd: region.sourceEnd });
        }
        inserted = true;
      } else {
        result.push(region);
      }
      elapsed += regionDur;
    }

    if (!inserted) {
      // Position is at or past the end
      result.push(...regions);
    }
    return result;
  }, [getTimeline]);

  const applyTimeline = useCallback((newTimeline: AudioRegion[]) => {
    setEditTimeline(newTimeline);
    const engine = engineRef.current;
    engine?.setEditTimeline(newTimeline);
    // Update duration
    const newDur = newTimeline.reduce((sum, r) => sum + (r.sourceEnd - r.sourceStart), 0);
    setDuration(newDur);
    // Recompute peaks to reflect edited waveform
    if (engine) {
      const editedOriginal = engine.getEditedPeaks(engine.getOriginalPeaks(800), 800);
      setOriginalPeaks(editedOriginal);
      // Also update stem peaks if available
      const stemNames = engine.stemNames;
      if (stemNames.length > 0) {
        const newStemPeaks: Record<string, Float32Array> = {};
        for (const name of STEM_DISPLAY_ORDER) {
          if (stemNames.includes(name)) {
            newStemPeaks[name] = engine.getEditedStemPeaks(name, 800);
          }
        }
        setStemPeaks(newStemPeaks);
      }
    }
    // Clear region selection (it may no longer be valid)
    setRegion(null);
  }, []);

  const handleEditCopy = useCallback(() => {
    if (!region) return;
    const regions = extractRegions(region.start, region.end);
    const clipDuration = regions.reduce((sum, r) => sum + (r.sourceEnd - r.sourceStart), 0);
    setEditClipboard({ regions, duration: clipDuration });
  }, [region, extractRegions]);

  const handleEditCut = useCallback(() => {
    if (!region) return;
    // Copy first
    const regions = extractRegions(region.start, region.end);
    const clipDuration = regions.reduce((sum, r) => sum + (r.sourceEnd - r.sourceStart), 0);
    setEditClipboard({ regions, duration: clipDuration });
    // Remove from timeline
    const newTimeline = removeFromTimeline(region.start, region.end);
    applyTimeline(newTimeline);
  }, [region, extractRegions, removeFromTimeline, applyTimeline]);

  const handleEditPaste = useCallback(() => {
    if (!editClipboard) return;
    const newTimeline = insertIntoTimeline(currentTime, editClipboard.regions);
    applyTimeline(newTimeline);
  }, [editClipboard, currentTime, insertIntoTimeline, applyTimeline]);

  const handleEditDelete = useCallback(() => {
    if (!region) return;
    const newTimeline = removeFromTimeline(region.start, region.end);
    applyTimeline(newTimeline);
  }, [region, removeFromTimeline, applyTimeline]);

  const handleUndoEdits = useCallback(() => {
    setEditTimeline(null);
    engineRef.current?.setEditTimeline(null);
    setDuration(engineRef.current?.originalDuration ?? 0);
    setRegion(null);
    setEditClipboard(null);
    // Restore original peaks
    const engine = engineRef.current;
    if (engine) {
      setOriginalPeaks(engine.getOriginalPeaks(800));
      const names = engine.stemNames;
      if (names.length > 0) {
        const peaks: Record<string, Float32Array> = {};
        for (const name of STEM_DISPLAY_ORDER) {
          if (names.includes(name)) {
            peaks[name] = engine.getStemPeaks(name, 800);
          }
        }
        setStemPeaks(peaks);
      }
    }
  }, []);

  // Global keyboard shortcuts for edit mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editorMode !== "edit") return;
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        e.preventDefault();
        handleEditCopy();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "x") {
        e.preventDefault();
        handleEditCut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        e.preventDefault();
        handleEditPaste();
      } else if (e.key === "Delete") {
        e.preventDefault();
        handleEditDelete();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editorMode, handleEditCopy, handleEditCut, handleEditPaste, handleEditDelete]);

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
      const exportRange = exportSelectionOnly && region ? region : undefined;
      const newJob = await startProcessing(track.track_id, operations, outputFormat, exportRange);
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
  }, [track, operations, outputFormat, exportSelectionOnly, region]);

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
    setBpm(0);
    setMasterTempo(false);
    setLoadingPhase("idle");
    setLoadingProgress(0);
    setEditClipboard(null);
    setEditTimeline(null);
    setEditorMode("stems");
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
            v1.0
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Upload Section */}
        {!track && !isUploading && loadingPhase === "idle" && (
          <div className="space-y-6">
            <FileUpload
              onFileSelected={handleFileSelected}
              isUploading={isUploading}
            />

            {/* Quality Preset Selector */}
            <div className="card">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Separation Quality</h3>
              <div className="grid grid-cols-3 gap-3">
                {(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setQuality(preset)}
                    className={`relative flex flex-col items-center gap-1 p-4 rounded-lg border transition-all ${
                      quality === preset
                        ? "border-stem-accent bg-stem-accent/10 ring-1 ring-stem-accent/30"
                        : "border-stem-border bg-stem-surface hover:border-gray-500"
                    }`}
                  >
                    <span className={`text-sm font-semibold ${quality === preset ? "text-stem-accent" : "text-gray-300"}`}>
                      {QUALITY_PRESETS[preset].label}
                    </span>
                    <span className="text-xs text-gray-500">
                      {QUALITY_PRESETS[preset].description}
                    </span>
                    {quality === preset && (
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-stem-accent" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
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

            {/* BPM Controls */}
            {track.bpm > 0 && (
              <BpmControls
                originalBpm={track.bpm}
                bpm={bpm}
                onBpmChange={handleBpmChange}
                masterTempo={masterTempo}
                onMasterTempoChange={handleMasterTempoChange}
              />
            )}

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
              stemsReady={stemsReady}
              editorMode={editorMode}
              editTimeline={editTimeline}
              editClipboard={editClipboard}
              onEditCopy={handleEditCopy}
              onEditCut={handleEditCut}
              onEditPaste={handleEditPaste}
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
                {/* Mode Toggle */}
                <div className="flex items-center gap-1 p-1 bg-stem-surface border border-stem-border rounded-lg w-fit">
                  <button
                    onClick={() => setEditorMode("stems")}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      editorMode === "stems"
                        ? "bg-stem-accent text-white shadow-sm"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M4 20V10M8 20V6M12 20V2M16 20V6M20 20V10" />
                      </svg>
                      Stems
                    </span>
                  </button>
                  <button
                    onClick={() => setEditorMode("edit")}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      editorMode === "edit"
                        ? "bg-stem-accent text-white shadow-sm"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      Edit
                    </span>
                  </button>
                </div>

                {/* Mode-specific controls */}
                {editorMode === "stems" ? (
                  <StemControls
                    onStemAction={handleStemAction}
                    region={region}
                    disabled={!stemsReady}
                  />
                ) : (
                  <EditControls
                    region={region}
                    clipboard={editClipboard}
                    currentTime={currentTime}
                    editedDuration={duration}
                    hasEdits={editTimeline !== null}
                    onCopy={handleEditCopy}
                    onCut={handleEditCut}
                    onPaste={handleEditPaste}
                    onDelete={handleEditDelete}
                    onUndoEdits={handleUndoEdits}
                  />
                )}

                {/* Operations Queue */}
                <OperationsList
                  operations={operations}
                  onRemove={handleRemoveOperation}
                />

                {/* Export Format Selector & Button */}
                {operations.length > 0 && !exportJob && (
                  <div className="card space-y-4">
                    <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                      Export Format
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {(Object.keys(OUTPUT_FORMATS) as OutputFormat[]).map((fmt) => (
                        <button
                          key={fmt}
                          onClick={() => setOutputFormat(fmt)}
                          className={`relative flex flex-col items-center gap-0.5 p-3 rounded-lg border transition-all ${
                            outputFormat === fmt
                              ? "border-stem-accent bg-stem-accent/10 ring-1 ring-stem-accent/30"
                              : "border-stem-border bg-stem-surface hover:border-gray-500"
                          }`}
                        >
                          <span className={`text-sm font-semibold ${outputFormat === fmt ? "text-stem-accent" : "text-gray-300"}`}>
                            {OUTPUT_FORMATS[fmt].label}
                          </span>
                          <span className="text-[10px] text-gray-500 text-center leading-tight">
                            {OUTPUT_FORMATS[fmt].description}
                          </span>
                          {outputFormat === fmt && (
                            <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-stem-accent" />
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Export Range Toggle */}
                    <div className="flex items-center justify-between p-3 rounded-lg border border-stem-border bg-stem-surface">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-300">Export selection only</span>
                        <span className="text-xs text-gray-500">
                          {region
                            ? `Selected: ${region.start.toFixed(1)}s – ${region.end.toFixed(1)}s`
                            : "Select a region on the waveform first"}
                        </span>
                      </div>
                      <button
                        onClick={() => setExportSelectionOnly((v) => !v)}
                        disabled={!region}
                        className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          exportSelectionOnly && region
                            ? "bg-stem-accent"
                            : "bg-gray-600"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                            exportSelectionOnly && region ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>

                    <button
                      onClick={handleExport}
                      disabled={isProcessing}
                      className="btn-primary w-full py-4 text-lg font-semibold disabled:opacity-50"
                    >
                      {isProcessing
                        ? "Starting..."
                        : `Export${exportSelectionOnly && region ? ` selection` : ""} as ${OUTPUT_FORMATS[outputFormat].label} (${operations.length} operation${operations.length > 1 ? "s" : ""})`}
                    </button>
                  </div>
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
