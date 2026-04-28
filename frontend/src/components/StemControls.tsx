import { useState } from "react";
import type { StemType, TimeRange } from "../types";
import { STEM_COLORS, STEM_LABELS } from "../types";

interface TimelineSelectorProps {
  duration: number;
  onRangeSelect: (range: TimeRange) => void;
}

export default function TimelineSelector({ duration, onRangeSelect }: TimelineSelectorProps) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(duration);

  const handleStartChange = (val: number) => {
    const clamped = Math.min(val, end - 0.1);
    setStart(clamped);
    onRangeSelect({ start: clamped, end });
  };

  const handleEndChange = (val: number) => {
    const clamped = Math.max(val, start + 0.1);
    setEnd(clamped);
    onRangeSelect({ start, end: clamped });
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
  };

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
        Time Range Selection
      </h3>
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-sm text-gray-400 mb-1">
            <span>Start: {formatTime(start)}</span>
            <span>End: {formatTime(end)}</span>
          </div>
          {/* Timeline bar */}
          <div className="relative h-8 bg-stem-bg rounded-lg overflow-hidden">
            {/* Selected range highlight */}
            <div
              className="absolute h-full bg-stem-accent/20 border-x-2 border-stem-accent"
              style={{
                left: `${(start / duration) * 100}%`,
                width: `${((end - start) / duration) * 100}%`,
              }}
            />
          </div>
          <div className="flex gap-4 mt-2">
            <label className="flex-1">
              <span className="text-xs text-gray-500">Start (s)</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={start}
                onChange={(e) => handleStartChange(parseFloat(e.target.value))}
                className="w-full accent-stem-accent"
              />
            </label>
            <label className="flex-1">
              <span className="text-xs text-gray-500">End (s)</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={end}
                onChange={(e) => handleEndChange(parseFloat(e.target.value))}
                className="w-full accent-stem-accent"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StemControlsProps {
  onStemSelect: (stem: StemType, action: "remove" | "isolate") => void;
  activeStem: StemType | null;
}

export function StemControls({ onStemSelect, activeStem }: StemControlsProps) {
  const stems: StemType[] = ["vocals", "drums", "bass", "other", "instrumental"];

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
        Stem Selection
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {stems.map((stem) => (
          <div
            key={stem}
            className={`rounded-lg border-2 p-3 transition-all cursor-pointer ${
              activeStem === stem
                ? "border-current scale-[1.02]"
                : "border-stem-border hover:border-current/50"
            }`}
            style={{ color: STEM_COLORS[stem] }}
          >
            <div className="text-sm font-semibold">{STEM_LABELS[stem]}</div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => onStemSelect(stem, "remove")}
                className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Remove
              </button>
              <button
                onClick={() => onStemSelect(stem, "isolate")}
                className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
              >
                Isolate
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
