import type { StemType, TimeRange } from "../types";
import { STEM_COLORS, STEM_LABELS } from "../types";

interface StemControlsProps {
  onStemAction: (stem: StemType, action: "remove" | "isolate") => void;
  region: TimeRange | null;
  disabled: boolean;
}

const STEMS: StemType[] = ["vocals", "drums", "bass", "guitar", "piano", "other"];

export default function StemControls({
  onStemAction,
  region,
  disabled,
}: StemControlsProps) {
  const noRegion = !region;

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">
        Stem Operations
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        {noRegion
          ? "Select a time range on the waveform first"
          : `Selected: ${fmt(region.start)} – ${fmt(region.end)}`}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {STEMS.map((stem) => (
          <div
            key={stem}
            className="rounded-lg border-2 p-3 transition-all"
            style={{
              borderColor: disabled || noRegion ? "#1e1e2e" : STEM_COLORS[stem] + "60",
              opacity: disabled || noRegion ? 0.5 : 1,
            }}
          >
            <div
              className="text-sm font-semibold flex items-center gap-2"
              style={{ color: STEM_COLORS[stem] }}
            >
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: STEM_COLORS[stem] }}
              />
              {STEM_LABELS[stem]}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => onStemAction(stem, "remove")}
                disabled={disabled || noRegion}
                className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Remove
              </button>
              <button
                onClick={() => onStemAction(stem, "isolate")}
                disabled={disabled || noRegion}
                className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
