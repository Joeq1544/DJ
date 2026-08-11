import type { AnalysisQueueStatus } from "../../../../shared/contracts";

type AnalysisAction = "queue" | "pause" | "resume" | null;

interface AnalysisControlsProps {
  status: AnalysisQueueStatus | null;
  loading: boolean;
  selectedCount: number;
  action: AnalysisAction;
  error: string | null;
  onAnalyze: () => void;
  onPause: () => void;
  onResume: () => void;
}

function wholePercent(progressPpm: number): number {
  return Math.round(progressPpm / 10_000);
}

function analyzeLabel(selectedCount: number, action: AnalysisAction): string {
  if (action === "queue") return "Queueing analysis…";
  return selectedCount === 0 ? "Analyze selected" : `Analyze ${selectedCount} selected`;
}

export function AnalysisControls({
  status,
  loading,
  selectedCount,
  action,
  error,
  onAnalyze,
  onPause,
  onResume,
}: AnalysisControlsProps) {
  const capabilities = status?.capabilities ?? null;
  const progress = wholePercent(status?.progressPpm ?? 0);
  const isBusy = action !== null;
  const analysisAvailable = capabilities?.available === true;

  return (
    <section className="analysis-transport" aria-labelledby="analysis-heading">
      <div className="analysis-transport__identity">
        <p className="eyebrow">Local signal</p>
        <h2 id="analysis-heading">Analysis</h2>
      </div>

      <div className="analysis-transport__state" aria-live="polite">
        {loading ? (
          <p className="analysis-transport__message" role="status">Loading analysis status…</p>
        ) : status === null ? (
          <p className="analysis-transport__message">Analysis status is unavailable.</p>
        ) : (
          <>
            <p className="analysis-transport__counts">
              {status.queued} queued · {status.running} running · {status.paused} paused · {status.succeeded} complete · {status.failed} failed
            </p>
            {status.state === "running" || status.state === "paused" ? (
              <div className="analysis-progress">
                <div
                  className="analysis-progress__track"
                  role="progressbar"
                  aria-label="Analysis progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <span className="analysis-progress__value" style={{ width: `${progress}%` }} />
                </div>
                <span>{progress}% complete</span>
              </div>
            ) : null}
          </>
        )}

        {capabilities?.available === false ? (
          <p className="analysis-transport__unavailable">{capabilities.unavailableReason}</p>
        ) : null}
        {capabilities?.available === true ? (
          <p className="analysis-transport__capabilities">
            <span>Structure unavailable</span>
            <span>Embeddings unavailable</span>
          </p>
        ) : null}
        {error !== null ? <p className="analysis-transport__error" role="alert">{error}</p> : null}
      </div>

      <div className="analysis-transport__actions">
        <button
          type="button"
          className="analysis-button analysis-button--primary"
          disabled={!analysisAvailable || selectedCount === 0 || isBusy}
          onClick={onAnalyze}
        >
          {analyzeLabel(selectedCount, action)}
        </button>
        {status?.state === "running" ? (
          <button type="button" className="analysis-button" disabled={isBusy} onClick={onPause}>
            {action === "pause" ? "Pausing analysis…" : "Pause analysis"}
          </button>
        ) : null}
        {status?.state === "paused" ? (
          <button type="button" className="analysis-button" disabled={isBusy} onClick={onResume}>
            {action === "resume" ? "Resuming analysis…" : "Resume analysis"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
