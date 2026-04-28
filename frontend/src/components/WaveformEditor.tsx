import {
  useRef,
  useEffect,
  useCallback,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { StemType, TimeRange, StemOperation } from "../types";
import { STEM_COLORS, STEM_LABELS } from "../types";

/* ── Constants ─────────────────────────────────────────────────────────── */

const WAVEFORM_HEIGHT = 140;
const OPS_BAR_HEIGHT = 18;
const TOTAL_HEIGHT = WAVEFORM_HEIGHT + OPS_BAR_HEIGHT + 6; // 6px gap
const BAR_GAP = 1;
const HANDLE_WIDTH = 8;

const DRAW_ORDER: StemType[] = ["other", "bass", "drums", "vocals"];

/* ── Props ─────────────────────────────────────────────────────────────── */

interface WaveformEditorProps {
  /** Original audio peaks (shown before stems are loaded) */
  originalPeaks: Float32Array | null;
  /** Per-stem peaks (shown once stems are separated) */
  stemPeaks: Record<string, Float32Array> | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  region: TimeRange | null;
  onRegionChange: (range: TimeRange | null) => void;
  onSeek: (time: number) => void;
  onPlayPause: () => void;
  operations: StemOperation[];
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

type DragState =
  | { type: "none" }
  | { type: "creating"; anchorTime: number }
  | { type: "resizing-start"; originalEnd: number }
  | { type: "resizing-end"; originalStart: number }
  | { type: "moving"; offset: number; rangeWidth: number };

function timeToX(time: number, duration: number, width: number): number {
  return (time / duration) * width;
}
function xToTime(x: number, duration: number, width: number): number {
  return Math.max(0, Math.min(duration, (x / width) * duration));
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── Component ─────────────────────────────────────────────────────────── */

export default function WaveformEditor({
  originalPeaks,
  stemPeaks,
  duration,
  currentTime,
  isPlaying,
  region,
  onRegionChange,
  onSeek,
  onPlayPause,
  operations,
}: WaveformEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>({ type: "none" });
  const [canvasWidth, setCanvasWidth] = useState(0);
  const dragRef = useRef<DragState>({ type: "none" });

  // Keep dragRef in sync
  dragRef.current = drag;

  /* ── Canvas sizing ─────────────────────────────────────────────────── */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setCanvasWidth(entry.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* ── Draw waveform ─────────────────────────────────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasWidth === 0 || duration === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = TOTAL_HEIGHT * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, canvasWidth, TOTAL_HEIGHT);

    const centerY = WAVEFORM_HEIGHT / 2;
    const maxBarHeight = centerY - 2;

    const hasStemPeaks = stemPeaks && Object.keys(stemPeaks).length > 0;

    if (hasStemPeaks) {
      // Draw multi-colored stem waveforms
      for (const stemName of DRAW_ORDER) {
        const peaks = stemPeaks[stemName];
        if (!peaks) continue;

        const color = STEM_COLORS[stemName as StemType];
        ctx.fillStyle = hexToRgba(color, 0.55);

        const numBars = peaks.length;
        const barWidth = Math.max(canvasWidth / numBars - BAR_GAP, 1);

        for (let i = 0; i < numBars; i++) {
          const barHeight = (peaks[i] ?? 0) * maxBarHeight;
          if (barHeight < 0.5) continue;
          const x = (i / numBars) * canvasWidth;
          ctx.fillRect(x, centerY - barHeight, barWidth, barHeight * 2);
        }
      }
    } else if (originalPeaks) {
      // Draw single-color original waveform
      ctx.fillStyle = "#4a4a6a";
      const numBars = originalPeaks.length;
      const barWidth = Math.max(canvasWidth / numBars - BAR_GAP, 1);

      for (let i = 0; i < numBars; i++) {
        const barHeight = (originalPeaks[i] ?? 0) * maxBarHeight;
        if (barHeight < 0.5) continue;
        const x = (i / numBars) * canvasWidth;
        ctx.fillRect(x, centerY - barHeight, barWidth, barHeight * 2);
      }
    }

    // ── Draw region highlight ─────────────────────────────────────────
    if (region) {
      const rx = timeToX(region.start, duration, canvasWidth);
      const rw = timeToX(region.end, duration, canvasWidth) - rx;

      // Darken areas outside the region
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, rx, WAVEFORM_HEIGHT);
      ctx.fillRect(rx + rw, 0, canvasWidth - rx - rw, WAVEFORM_HEIGHT);

      // Region border
      ctx.strokeStyle = "#7c3aed";
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, 0, rw, WAVEFORM_HEIGHT);

      // Handles
      ctx.fillStyle = "#7c3aed";
      ctx.fillRect(rx - 2, 0, 4, WAVEFORM_HEIGHT);
      ctx.fillRect(rx + rw - 2, 0, 4, WAVEFORM_HEIGHT);

      // Region time labels
      ctx.font = "11px monospace";
      ctx.fillStyle = "#c4b5fd";
      ctx.textAlign = "left";
      ctx.fillText(formatTime(region.start), rx + 6, 14);
      ctx.textAlign = "right";
      ctx.fillText(formatTime(region.end), rx + rw - 6, 14);
    }

    // ── Draw operations bar ───────────────────────────────────────────
    const opsY = WAVEFORM_HEIGHT + 6;
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(0, opsY, canvasWidth, OPS_BAR_HEIGHT);

    for (const op of operations) {
      const ox = timeToX(op.time_range.start, duration, canvasWidth);
      const ow =
        timeToX(op.time_range.end, duration, canvasWidth) - ox;
      const color = STEM_COLORS[op.stem];

      if (op.action === "remove") {
        // Striped pattern for remove
        ctx.fillStyle = hexToRgba(color, 0.4);
        ctx.fillRect(ox, opsY, ow, OPS_BAR_HEIGHT);
        ctx.strokeStyle = hexToRgba(color, 0.7);
        ctx.lineWidth = 1;
        for (let sx = ox; sx < ox + ow; sx += 6) {
          ctx.beginPath();
          ctx.moveTo(sx, opsY);
          ctx.lineTo(sx + OPS_BAR_HEIGHT, opsY + OPS_BAR_HEIGHT);
          ctx.stroke();
        }
      } else {
        // Solid for isolate
        ctx.fillStyle = hexToRgba(color, 0.6);
        ctx.fillRect(ox, opsY, ow, OPS_BAR_HEIGHT);
      }

      // Label
      ctx.font = "9px sans-serif";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      if (ow > 30) {
        const label = `${op.action === "remove" ? "−" : "♪"} ${STEM_LABELS[op.stem].split(" ")[0]}`;
        ctx.fillText(label, ox + ow / 2, opsY + 13);
      }
    }
  }, [canvasWidth, originalPeaks, stemPeaks, duration, region, operations]);

  /* ── Cursor ────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!cursorRef.current || duration === 0 || canvasWidth === 0) return;
    const pct = (currentTime / duration) * 100;
    cursorRef.current.style.left = `${pct}%`;
  }, [currentTime, duration, canvasWidth]);

  /* ── Mouse interaction ─────────────────────────────────────────────── */

  const getTimeFromEvent = useCallback(
    (e: ReactMouseEvent) => {
      if (!canvasRef.current) return 0;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      return xToTime(x, duration, rect.width);
    },
    [duration]
  );

  const hitTest = useCallback(
    (e: ReactMouseEvent): "start-handle" | "end-handle" | "inside" | "outside" => {
      if (!region || !canvasRef.current) return "outside";
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const startX = timeToX(region.start, duration, rect.width);
      const endX = timeToX(region.end, duration, rect.width);

      if (Math.abs(x - startX) < HANDLE_WIDTH) return "start-handle";
      if (Math.abs(x - endX) < HANDLE_WIDTH) return "end-handle";
      if (x > startX && x < endX) return "inside";
      return "outside";
    },
    [region, duration]
  );

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const time = getTimeFromEvent(e);
      const hit = hitTest(e);

      if (hit === "start-handle" && region) {
        setDrag({ type: "resizing-start", originalEnd: region.end });
      } else if (hit === "end-handle" && region) {
        setDrag({ type: "resizing-end", originalStart: region.start });
      } else if (hit === "inside" && region) {
        setDrag({
          type: "moving",
          offset: time - region.start,
          rangeWidth: region.end - region.start,
        });
      } else {
        // Start creating a new region
        setDrag({ type: "creating", anchorTime: time });
      }
    },
    [getTimeFromEvent, hitTest, region]
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      const d = dragRef.current;
      if (d.type === "none") {
        // Update cursor style based on hit test
        const hit = hitTest(e);
        const el = containerRef.current;
        if (el) {
          el.style.cursor =
            hit === "start-handle" || hit === "end-handle"
              ? "ew-resize"
              : hit === "inside"
                ? "grab"
                : "crosshair";
        }
        return;
      }

      const time = getTimeFromEvent(e);

      if (d.type === "creating") {
        const start = Math.min(d.anchorTime, time);
        const end = Math.max(d.anchorTime, time);
        if (end - start > 0.1) {
          onRegionChange({ start, end });
        }
      } else if (d.type === "resizing-start") {
        const newStart = Math.min(time, d.originalEnd - 0.1);
        onRegionChange({ start: Math.max(0, newStart), end: d.originalEnd });
      } else if (d.type === "resizing-end") {
        const newEnd = Math.max(time, d.originalStart + 0.1);
        onRegionChange({
          start: d.originalStart,
          end: Math.min(duration, newEnd),
        });
      } else if (d.type === "moving") {
        let newStart = time - d.offset;
        newStart = Math.max(0, Math.min(newStart, duration - d.rangeWidth));
        onRegionChange({ start: newStart, end: newStart + d.rangeWidth });
      }
    },
    [getTimeFromEvent, hitTest, onRegionChange, duration]
  );

  const handleMouseUp = useCallback(
    (e: ReactMouseEvent) => {
      const d = dragRef.current;
      if (d.type === "creating") {
        const time = getTimeFromEvent(e);
        const dist = Math.abs(time - d.anchorTime);
        if (dist < 0.1) {
          // It was a click, not a drag — seek
          onSeek(time);
          onRegionChange(null);
        }
      }
      setDrag({ type: "none" });
    },
    [getTimeFromEvent, onSeek, onRegionChange]
  );

  /* ── Keyboard ──────────────────────────────────────────────────────── */

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        onPlayPause();
      }
    },
    [onPlayPause]
  );

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <div className="card p-0 overflow-hidden">
      {/* Play button + time */}
      <div className="flex items-center gap-4 px-6 pt-5 pb-3">
        <button
          onClick={onPlayPause}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-stem-accent hover:bg-stem-accent-hover transition-colors flex-shrink-0"
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>
        <span className="text-sm text-gray-400 font-mono tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Stem legend */}
        {stemPeaks && (
          <div className="flex gap-3 ml-auto">
            {DRAW_ORDER.map((stem) => (
              <div key={stem} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: STEM_COLORS[stem] }}
                />
                <span className="text-xs text-gray-500">
                  {STEM_LABELS[stem].split(" ")[0]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Waveform canvas + overlays */}
      <div
        ref={containerRef}
        className="relative px-0 pb-4 select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setDrag({ type: "none" })}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{ outline: "none" }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: TOTAL_HEIGHT }}
          className="block"
        />

        {/* Cursor line */}
        <div
          ref={cursorRef}
          className="absolute top-0 w-0.5 bg-white/80 pointer-events-none"
          style={{ height: WAVEFORM_HEIGHT, left: "0%" }}
        />

        {/* Region hint text */}
        {!region && duration > 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xs text-gray-600 bg-stem-bg/80 px-3 py-1 rounded">
              Drag to select a time range
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
