import type { TimeRange, EditClipboard } from "../types";

interface EditControlsProps {
  region: TimeRange | null;
  clipboard: EditClipboard | null;
  currentTime: number;
  editedDuration: number;
  hasEdits: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onUndoEdits: () => void;
}

export default function EditControls({
  region,
  clipboard,
  currentTime,
  editedDuration,
  hasEdits,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onUndoEdits,
}: EditControlsProps) {
  const noRegion = !region;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Edit Timeline
        </h3>
        <span className="text-xs text-gray-500 font-mono">
          Duration: {fmt(editedDuration)}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        {noRegion
          ? "Select a region on the waveform to copy, cut, or delete. Position the cursor to paste."
          : `Selected: ${fmt(region.start)} – ${fmt(region.end)} (${(region.end - region.start).toFixed(2)}s)`}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onCopy}
          disabled={noRegion}
          className="edit-btn bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Copy selection to clipboard (Ctrl+C)"
        >
          <CopyIcon /> Copy
        </button>
        <button
          onClick={onCut}
          disabled={noRegion}
          className="edit-btn bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Cut selection — removes from timeline and copies to clipboard (Ctrl+X)"
        >
          <CutIcon /> Cut
        </button>
        <button
          onClick={onPaste}
          disabled={!clipboard}
          className="edit-btn bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Paste clipboard at cursor position — inserts audio (Ctrl+V)"
        >
          <PasteIcon /> Paste at {fmt(currentTime)}
        </button>
        <button
          onClick={onDelete}
          disabled={noRegion}
          className="edit-btn bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Delete selection — removes from timeline (Del)"
        >
          <DeleteIcon /> Delete
        </button>

        {hasEdits && (
          <button
            onClick={onUndoEdits}
            className="edit-btn bg-gray-500/20 text-gray-400 hover:bg-gray-500/30 ml-auto"
            title="Reset all timeline edits"
          >
            <UndoIcon /> Reset edits
          </button>
        )}
      </div>

      {/* Clipboard info */}
      {clipboard && (
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-3 pt-3 border-t border-stem-border">
          <ClipboardIcon />
          <span>
            Clipboard: {clipboard.duration.toFixed(2)}s of audio
          </span>
        </div>
      )}

      {/* Help text */}
      <div className="mt-3 pt-3 border-t border-stem-border">
        <p className="text-[11px] text-gray-600 leading-relaxed">
          <strong className="text-gray-500">Copy</strong> saves the selected region. 
          <strong className="text-gray-500"> Cut</strong> removes it from the song (shortens it) and saves to clipboard. 
          <strong className="text-gray-500"> Paste</strong> inserts clipboard audio at the cursor (lengthens the song). 
          <strong className="text-gray-500"> Delete</strong> removes the selection without copying.
          Stem operations from Stems mode still apply to the edited result.
        </p>
      </div>
    </div>
  );
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

function CutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
      <line x1="20" y1="4" x2="8.12" y2="15.88"/>
      <line x1="14.47" y1="14.48" x2="20" y2="20"/>
      <line x1="8.12" y1="8.12" x2="12" y2="12"/>
    </svg>
  );
}

function PasteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,6 5,6 21,6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,4 1,10 7,10"/>
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
    </svg>
  );
}
