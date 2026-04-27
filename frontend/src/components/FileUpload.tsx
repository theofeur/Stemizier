import { useCallback, useState, type DragEvent } from "react";

interface FileUploadProps {
  onFileSelected: (file: File) => void;
  isUploading: boolean;
}

export default function FileUpload({ onFileSelected, isUploading }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && isAudioFile(file)) {
        onFileSelected(file);
      }
    },
    [onFileSelected]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelected(file);
    },
    [onFileSelected]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`card flex flex-col items-center justify-center gap-4 py-16 cursor-pointer transition-all duration-200 ${
        isDragOver
          ? "border-stem-accent bg-stem-accent/5 scale-[1.01]"
          : "border-stem-border hover:border-stem-accent/50"
      }`}
    >
      {isUploading ? (
        <>
          <div className="w-10 h-10 border-4 border-stem-accent/30 border-t-stem-accent rounded-full animate-spin" />
          <p className="text-gray-400">Uploading...</p>
        </>
      ) : (
        <>
          <div className="text-5xl text-stem-accent">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-lg font-medium text-gray-200">
              Drop your audio file here
            </p>
            <p className="text-sm text-gray-500 mt-1">MP3 or WAV — up to 500MB</p>
          </div>
          <label className="btn-primary cursor-pointer mt-2">
            Browse Files
            <input
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
        </>
      )}
    </div>
  );
}

function isAudioFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "mp3" || ext === "wav";
}
