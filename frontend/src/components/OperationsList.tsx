import type { StemOperation } from "../types";
import { STEM_COLORS, STEM_LABELS } from "../types";

interface OperationsListProps {
  operations: StemOperation[];
  onRemove: (index: number) => void;
}

export default function OperationsList({ operations, onRemove }: OperationsListProps) {
  if (operations.length === 0) {
    return (
      <div className="card text-center text-gray-500 py-8">
        <p>No operations added yet.</p>
        <p className="text-sm mt-1">Select a time range and stem to get started.</p>
      </div>
    );
  }

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
        Operations Queue ({operations.length})
      </h3>
      <div className="space-y-2">
        {operations.map((op, i) => (
          <div
            key={i}
            className="flex items-center justify-between bg-stem-bg rounded-lg px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: STEM_COLORS[op.stem] }}
              />
              <span className="text-sm font-medium">
                {op.action === "remove" ? "Remove" : "Isolate"}{" "}
                <span style={{ color: STEM_COLORS[op.stem] }}>
                  {STEM_LABELS[op.stem]}
                </span>
              </span>
              <span className="text-xs text-gray-500 font-mono">
                {formatTime(op.time_range.start)} — {formatTime(op.time_range.end)}
              </span>
            </div>
            <button
              onClick={() => onRemove(i)}
              className="text-gray-500 hover:text-red-400 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
