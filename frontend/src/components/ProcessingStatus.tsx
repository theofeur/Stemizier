import type { ProcessingJob } from "../types";

interface ProcessingStatusProps {
  job: ProcessingJob;
  onDownload: () => void;
}

export default function ProcessingStatus({ job, onDownload }: ProcessingStatusProps) {
  const statusLabels: Record<string, string> = {
    pending: "Queued...",
    separating: "Separating stems with AI...",
    processing: "Applying operations...",
    complete: "Done!",
    failed: "Processing failed",
  };

  const statusColors: Record<string, string> = {
    pending: "text-yellow-400",
    separating: "text-blue-400",
    processing: "text-purple-400",
    complete: "text-green-400",
    failed: "text-red-400",
  };

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
        Processing
      </h3>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {job.status !== "complete" && job.status !== "failed" && (
            <div className="w-5 h-5 border-2 border-stem-accent/30 border-t-stem-accent rounded-full animate-spin" />
          )}
          <span className={`font-medium ${statusColors[job.status] ?? "text-gray-400"}`}>
            {statusLabels[job.status] ?? job.status}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-stem-bg rounded-full overflow-hidden">
          <div
            className="h-full bg-stem-accent rounded-full transition-all duration-500"
            style={{ width: `${job.progress}%` }}
          />
        </div>

        {job.status === "complete" && (
          <button onClick={onDownload} className="btn-primary w-full">
            Download Processed Track
          </button>
        )}

        {job.status === "failed" && job.error && (
          <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">
            {job.error}
          </p>
        )}
      </div>
    </div>
  );
}
