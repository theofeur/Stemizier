import {
  useRef,
  useEffect,
  useCallback,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { StemType, TimeRange, StemOperation } from "../types";
import { STEM_COLORS, STEM_LABELS } from "../types";

/* ── Constants ─────────────────────────────────────────────────────────── */

const WAVEFORM_HEIGHT = 140;
const OPS_BAR_HEIGHT = 18;
const SCROLLBAR_HEIGHT = 10;
const TOTAL_HEIGHT = WAVEFORM_HEIGHT + OPS_BAR_HEIGHT + 6; // 6px gap
const BAR_GAP = 1;
const HANDLE_WIDTH = 8;
const MIN_ZOOM = 1;
const MAX_ZOOM = 50;

const DRAW_ORDER: StemType[] = ["other", "bass", "drums", "vocals"];

/* ── Props ─────────────────────────────────────────────────────────────── */

interface WaveformEditorProps {
  originalPeaks: Float32Array | null;
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
  | { type: "moving"; offset: number; rangeWidth: number }
  | { type: "scrollbar"; startX: number; startOffset: number };

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

function formatTimeShort(sec: number): string {
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
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>({ type: "none" });
  const [canvasWidth, setCanvasWidth] = useState(0);
  const dragRef = useRef<DragState>({ type: "none" });

  // Zoom/scroll state
  const [zoom, setZoom] = useState(1);
  const [viewOffset, setViewOffset] = useState(0);

  // Keep dragRef in sync
  dragRef.current = drag;

  // Derived: visible time window
  const visibleDuration = duration / zoom;
  const viewStart = viewOffset;
  const viewEnd = viewOffset + visibleDuration;

  // Coordinate helpers (viewport-aware)
  const timeToX = useCallback(
    (time: number): number => {
      return ((time - viewStart) / visibleDuration) * canvasWidth;
    },
    [viewStart, visibleDuration, canvasWidth]
  );

  const xToTime = useCallback(
    (x: number): number => {
      const t = viewStart + (x / canvasWidth) * visibleDuration;
      return Math.max(0, Math.min(duration, t));
    },
    [viewStart, visibleDuration, canvasWidth, duration]
  );

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

  /* ── Keep view following playhead ──────────────────────────────────── */

  useEffect(() => {
    if (!isPlaying || zoom <= 1) return;
    if (currentTime < viewStart || currentTime > viewEnd - visibleDuration * 0.1) {
      const newOffset = Math.max(0, Math.min(duration - visibleDuration, currentTime - visibleDuration * 0.1));
      setViewOffset(newOffset);
    }
  }, [currentTime, isPlaying, zoom, viewStart, viewEnd, visibleDuration, duration]);

  /* ── Draw waveform ─────────────────────────────────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasWidth === 0 || duration === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = TOTAL_HEIGHT * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasWidth, TOTAL_HEIGHT);

    const centerY = WAVEFORM_HEIGHT / 2;
    const maxBarHeight = centerY - 2;

    const hasStemPeaks = stemPeaks && Object.keys(stemPeaks).length > 0;

    const drawPeaks = (peaks: Float32Array, color: string) => {
      ctx.fillStyle = color;
      const numBars = peaks.length;
      const startIdx = Math.floor((viewStart / duration) * numBars);
      const endIdx = Math.ceil((viewEnd / duration) * numBars);
      const visibleBars = endIdx - startIdx;
      const barWidth = Math.max(canvasWidth / visibleBars - BAR_GAP, 1);

      for (let i = startIdx; i < endIdx && i < numBars; i++) {
        const barHeight = (peaks[i] ?? 0) * maxBarHeight;
        if (barHeight < 0.5) continue;
        const x = ((i - startIdx) / visibleBars) * canvasWidth;
        ctx.fillRect(x, centerY - barHeight, barWidth, barHeight * 2);
      }
    };

    if (hasStemPeaks) {
      for (const stemName of DRAW_ORDER) {
        const peaks = stemPeaks[stemName];
        if (!peaks) continue;
        drawPeaks(peaks, hexToRgba(STEM_COLORS[stemName as StemType], 0.55));
      }
    } else if (originalPeaks) {
      drawPeaks(originalPeaks, "#4a4a6a");
    }

    // ── Region highlight ──────────────────────────────────────────────
    if (region) {
      const rx = timeToX(region.start);
      const rw = timeToX(region.end) - rx;

      if (rx < canvasWidth && rx + rw > 0) {
        const clampedRx = Math.max(0, rx);
        const clampedEnd = Math.min(canvasWidth, rx + rw);

        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, clampedRx, WAVEFORM_HEIGHT);
        ctx.fillRect(clampedEnd, 0, canvasWidth - clampedEnd, WAVEFORM_HEIGHT);

        ctx.strokeStyle = "#7c3aed";
        ctx.lineWidth = 2;
        ctx.strokeRect(clampedRx, 0, clampedEnd - clampedRx, WAVEFORM_HEIGHT);

        ctx.fillStyle = "#7c3aed";
        if (rx >= 0 && rx <= canvasWidth) ctx.fillRect(rx - 2, 0, 4, WAVEFORM_HEIGHT);
        if (rx + rw >= 0 && rx + rw <= canvasWidth) ctx.fillRect(rx + rw - 2, 0, 4, WAVEFORM_HEIGHT);

        ctx.font = "11px monospace";
        ctx.fillStyle = "#c4b5fd";
        if (clampedRx > 0) {
          ctx.textAlign = "left";
          ctx.fillText(formatTime(region.start), clampedRx + 6, 14);
        }
        if (clampedEnd < canvasWidth) {
          ctx.textAlign = "right";
          ctx.fillText(formatTime(region.end), clampedEnd - 6, 14);
        }
      }
    }

    // ── Operations bar ────────────────────────────────────────────────
    const opsY = WAVEFORM_HEIGHT + 6;
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(0, opsY, canvasWidth, OPS_BAR_HEIGHT);

    for (const op of operations) {
      const ox = timeToX(op.time_range.start);
      const ow = timeToX(op.time_range.end) - ox;
      if (ox > canvasWidth || ox + ow < 0) continue;

      const color = STEM_COLORS[op.stem];
      const drawX = Math.max(0, ox);
      const drawW = Math.min(ox + ow, canvasWidth) - drawX;

      if (op.action === "remove") {
        ctx.fillStyle = hexToRgba(color, 0.4);
        ctx.fillRect(drawX, opsY, drawW, OPS_BAR_HEIGHT);
        ctx.strokeStyle = hexToRgba(color, 0.7);
        ctx.lineWidth = 1;
        for (let sx = drawX; sx < drawX + drawW; sx += 6) {
          ctx.beginPath();
          ctx.moveTo(sx, opsY);
          ctx.lineTo(sx + OPS_BAR_HEIGHT, opsY + OPS_BAR_HEIGHT);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = hexToRgba(color, 0.6);
        ctx.fillRect(drawX, opsY, drawW, OPS_BAR_HEIGHT);
      }

      if (drawW > 30) {
        ctx.font = "9px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        const label = `${op.action === "remove" ? "−" : "♪"} ${STEM_LABELS[op.stem].split(" ")[0]}`;
        ctx.fillText(label, drawX + drawW / 2, opsY + 13);
      }
    }
  }, [canvasWidth, originalPeaks, stemPeaks, duration, region, operations, zoom, viewOffset, timeToX, viewStart, viewEnd]);

  /* ── Cursor ────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!cursorRef.current || duration === 0 || canvasWidth === 0) return;
    const x = timeToX(currentTime);
    cursorRef.current.style.left = `${x}px`;
    cursorRef.current.style.display = x >= 0 && x <= canvasWidth ? "block" : "none";
  }, [currentTime, duration, canvasWidth, timeToX]);

  /* ── Zoom (Ctrl+wheel) / Pan (wheel) ───────────────────────────────── */

  const handleWheel = useCallback(
    (e: ReactWheelEvent) => {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseTime = xToTime(mouseX);

      if (e.ctrlKey || e.metaKey) {
        const zoomFactor = e.deltaY < 0 ? 1.3 : 1 / 1.3;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * zoomFactor));
        const newVisibleDuration = duration / newZoom;
        const mouseRatio = mouseX / canvasWidth;
        const newOffset = mouseTime - mouseRatio * newVisibleDuration;
        const clampedOffset = Math.max(0, Math.min(duration - newVisibleDuration, newOffset));

        setZoom(newZoom);
        setViewOffset(clampedOffset);
      } else {
        const scrollAmount = (e.deltaY / canvasWidth) * visibleDuration * 3;
        const newOffset = Math.max(0, Math.min(duration - visibleDuration, viewOffset + scrollAmount));
        setViewOffset(newOffset);
      }
    },
    [zoom, viewOffset, duration, visibleDuration, canvasWidth, xToTime]
  );

  /* ── Mouse interaction ─────────────────────────────────────────────── */

  const getTimeFromEvent = useCallback(
    (e: ReactMouseEvent) => {
      if (!canvasRef.current) return 0;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      return xToTime(x);
    },
    [xToTime]
  );

  const hitTest = useCallback(
    (e: ReactMouseEvent): "start-handle" | "end-handle" | "inside" | "outside" => {
      if (!region || !canvasRef.current) return "outside";
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const startX = timeToX(region.start);
      const endX = timeToX(region.end);

      if (Math.abs(x - startX) < HANDLE_WIDTH) return "start-handle";
      if (Math.abs(x - endX) < HANDLE_WIDTH) return "end-handle";
      if (x > startX && x < endX) return "inside";
      return "outside";
    },
    [region, timeToX]
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
        setDrag({ type: "creating", anchorTime: time });
      }
    },
    [getTimeFromEvent, hitTest, region]
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      const d = dragRef.current;

      // Handle scrollbar drag
      if (d.type === "scrollbar") {
        const rect = scrollbarRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = e.clientX - d.startX;
        const timeDelta = (dx / rect.width) * duration;
        const newOffset = Math.max(0, Math.min(duration - visibleDuration, d.startOffset + timeDelta));
        setViewOffset(newOffset);
        return;
      }

      if (d.type === "none") {
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
        if (end - start > 0.05) {
          onRegionChange({ start, end });
        }
      } else if (d.type === "resizing-start") {
        const newStart = Math.min(time, d.originalEnd - 0.05);
        onRegionChange({ start: Math.max(0, newStart), end: d.originalEnd });
      } else if (d.type === "resizing-end") {
        const newEnd = Math.max(time, d.originalStart + 0.05);
        onRegionChange({ start: d.originalStart, end: Math.min(duration, newEnd) });
      } else if (d.type === "moving") {
        let newStart = time - d.offset;
        newStart = Math.max(0, Math.min(newStart, duration - d.rangeWidth));
        onRegionChange({ start: newStart, end: newStart + d.rangeWidth });
      }
    },
    [getTimeFromEvent, hitTest, onRegionChange, duration, visibleDuration]
  );

  const handleMouseUp = useCallback(
    (e: ReactMouseEvent) => {
      const d = dragRef.current;
      if (d.type === "creating") {
        const time = getTimeFromEvent(e);
        const dist = Math.abs(time - d.anchorTime);
        if (dist < 0.05) {
          onSeek(time);
          onRegionChange(null);
        }
      }
      setDrag({ type: "none" });
    },
    [getTimeFromEvent, onSeek, onRegionChange]
  );

  /* ── Scrollbar ─────────────────────────────────────────────────────── */

  const handleScrollbarMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = scrollbarRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const thumbWidth = (1 / zoom) * rect.width;
      const thumbLeft = (viewOffset / duration) * rect.width;

      if (x >= thumbLeft && x <= thumbLeft + thumbWidth) {
        setDrag({ type: "scrollbar", startX: e.clientX, startOffset: viewOffset });
      } else {
        const newOffset = Math.max(0, Math.min(duration - visibleDuration, (x / rect.width) * duration - visibleDuration / 2));
        setViewOffset(newOffset);
      }
    },
    [zoom, viewOffset, duration, visibleDuration]
  );

  /* ── Keyboard ──────────────────────────────────────────────────────── */

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        onPlayPause();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoom((z) => Math.min(MAX_ZOOM, z * 1.5));
      } else if (e.key === "-") {
        e.preventDefault();
        const newZoom = Math.max(MIN_ZOOM, zoom / 1.5);
        setZoom(newZoom);
        const newVis = duration / newZoom;
        setViewOffset((o) => Math.max(0, Math.min(duration - newVis, o)));
      } else if (e.key === "0") {
        e.preventDefault();
        setZoom(1);
        setViewOffset(0);
      }
    },
    [onPlayPause, zoom, duration]
  );

  /* ── Render ────────────────────────────────────────────────────────── */

  const thumbWidthPct = zoom > 1 ? `${(1 / zoom) * 100}%` : "100%";
  const thumbLeftPct = zoom > 1 ? `${(viewOffset / duration) * 100}%` : "0%";

  return (
    <div className="card p-0 overflow-hidden">
      {/* Play button + time + zoom controls */}
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
          {formatTime(currentTime)} / {formatTimeShort(duration)}
        </span>

        {/* Zoom controls */}
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => {
              const newZoom = Math.max(MIN_ZOOM, zoom / 1.5);
              setZoom(newZoom);
              const newVis = duration / newZoom;
              setViewOffset((o) => Math.max(0, Math.min(duration - newVis, o)));
            }}
            className="w-7 h-7 flex items-center justify-center rounded bg-stem-surface border border-stem-border text-gray-400 hover:text-white hover:border-stem-accent/50 transition-colors text-sm"
            title="Zoom out (−)"
          >
            −
          </button>
          <span className="text-xs text-gray-500 w-10 text-center tabular-nums">
            {zoom.toFixed(1)}x
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5))}
            className="w-7 h-7 flex items-center justify-center rounded bg-stem-surface border border-stem-border text-gray-400 hover:text-white hover:border-stem-accent/50 transition-colors text-sm"
            title="Zoom in (+)"
          >
            +
          </button>
          {zoom > 1 && (
            <button
              onClick={() => { setZoom(1); setViewOffset(0); }}
              className="ml-1 text-xs text-gray-500 hover:text-white transition-colors"
              title="Reset zoom (0)"
            >
              Reset
            </button>
          )}
        </div>

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
        className="relative px-0 select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setDrag({ type: "none" })}
        onWheel={handleWheel}
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
          style={{ height: WAVEFORM_HEIGHT, left: "0px" }}
        />

        {/* Hint */}
        {!region && duration > 0 && zoom <= 1 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xs text-gray-600 bg-stem-bg/80 px-3 py-1 rounded">
              Drag to select · Ctrl+Scroll to zoom · Scroll to pan
            </span>
          </div>
        )}
      </div>

      {/* Scrollbar (when zoomed) */}
      {zoom > 1 && (
        <div
          ref={scrollbarRef}
          className="relative mx-4 mb-3 mt-1 rounded-full bg-stem-bg/50 cursor-pointer"
          style={{ height: SCROLLBAR_HEIGHT }}
          onMouseDown={handleScrollbarMouseDown}
        >
          <div
            className="absolute top-0 h-full rounded-full bg-stem-accent/40 hover:bg-stem-accent/60 transition-colors"
            style={{ width: thumbWidthPct, left: thumbLeftPct }}
          />
        </div>
      )}

      {zoom <= 1 && <div className="pb-4" />}
    </div>
  );
}
