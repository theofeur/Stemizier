interface BpmControlsProps {
  originalBpm: number;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  masterTempo: boolean;
  onMasterTempoChange: (enabled: boolean) => void;
}

export default function BpmControls({
  originalBpm,
  bpm,
  onBpmChange,
  masterTempo,
  onMasterTempoChange,
}: BpmControlsProps) {
  if (originalBpm <= 0) return null;

  const ratio = bpm / originalBpm;
  const pctChange = Math.round((ratio - 1) * 100);
  const isChanged = Math.abs(pctChange) > 0;

  const clamp = (v: number) => Math.max(originalBpm * 0.5, Math.min(originalBpm * 2, v));

  const nudge = (delta: number) => {
    onBpmChange(clamp(Math.round((bpm + delta) * 10) / 10));
  };

  return (
    <div className="card flex flex-col sm:flex-row sm:items-center gap-4">
      {/* BPM display + nudge buttons */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider w-8">BPM</span>

        <button
          onClick={() => nudge(-1)}
          className="w-8 h-8 rounded-lg bg-stem-bg border border-stem-border text-gray-400 hover:text-white hover:border-gray-500 transition-colors text-lg leading-none flex items-center justify-center"
        >
          −
        </button>

        <input
          type="number"
          value={bpm}
          step={0.1}
          min={originalBpm * 0.5}
          max={originalBpm * 2}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onBpmChange(clamp(v));
          }}
          className="w-20 text-center text-lg font-bold bg-stem-bg border border-stem-border rounded-lg px-2 py-1 text-white focus:outline-none focus:border-stem-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />

        <button
          onClick={() => nudge(1)}
          className="w-8 h-8 rounded-lg bg-stem-bg border border-stem-border text-gray-400 hover:text-white hover:border-gray-500 transition-colors text-lg leading-none flex items-center justify-center"
        >
          +
        </button>

        {/* Percentage indicator */}
        {isChanged && (
          <span className={`text-xs font-medium ${pctChange > 0 ? "text-green-400" : "text-orange-400"}`}>
            {pctChange > 0 ? "+" : ""}{pctChange}%
          </span>
        )}
      </div>

      {/* Tempo slider */}
      <div className="flex-1 flex items-center gap-2">
        <span className="text-[10px] text-gray-600">−50%</span>
        <input
          type="range"
          min={50}
          max={200}
          step={1}
          value={Math.round(ratio * 100)}
          onChange={(e) => {
            const pct = parseInt(e.target.value);
            onBpmChange(clamp(Math.round(originalBpm * pct) / 100));
          }}
          className="flex-1 h-1.5 accent-stem-accent cursor-pointer"
        />
        <span className="text-[10px] text-gray-600">+100%</span>
      </div>

      {/* Reset + Master Tempo */}
      <div className="flex items-center gap-2">
        {isChanged && (
          <button
            onClick={() => onBpmChange(originalBpm)}
            className="text-xs text-gray-500 hover:text-white transition-colors px-2 py-1"
          >
            Reset
          </button>
        )}

        <button
          onClick={() => onMasterTempoChange(!masterTempo)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
            masterTempo
              ? "border-stem-accent bg-stem-accent/20 text-stem-accent"
              : "border-stem-border bg-stem-bg text-gray-500 hover:text-gray-300 hover:border-gray-500"
          }`}
          title={masterTempo ? "Master Tempo ON — pitch is preserved when changing BPM" : "Master Tempo OFF — pitch changes with BPM"}
        >
          ♪ Master Tempo
        </button>
      </div>
    </div>
  );
}
