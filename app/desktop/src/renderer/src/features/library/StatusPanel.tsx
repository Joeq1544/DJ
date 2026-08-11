import type { AppStatus } from "../../../../shared/contracts";

interface StatusPanelProps {
  status: AppStatus | null;
  loading: boolean;
  partialError: string | null;
  importMessage: string | null;
  importError: string | null;
}

function statusCopy(status: AppStatus | null, loading: boolean): string {
  if (loading) return "Loading library workspace";
  if (status === null) return "Library service status is unavailable";
  if (status.state === "starting") return "Starting library service";
  if (status.state === "ready") return "Library service ready";
  if (status.state === "retrying") return "Reconnecting to library service";
  return "Library service is unavailable";
}

export function StatusPanel({ status, loading, partialError, importMessage, importError }: StatusPanelProps) {
  const copy = statusCopy(status, loading);
  const isDegraded = status?.state === "degraded";
  return (
    <section className="status-panel" aria-label="Library service state">
      <p className="status-panel__state" role="status" aria-live="polite">{copy}</p>
      {status?.message ? <p className="status-panel__detail">{status.message}</p> : null}
      {isDegraded ? <p className="status-panel__detail">Quit and reopen DJ Copilot, then try again.</p> : null}
      {partialError ? <p className="status-panel__detail">Some library data could not be loaded: {partialError}</p> : null}
      {importMessage ? <p className="status-panel__success" role="status" aria-live="polite">{importMessage}</p> : null}
      {importError ? <p className="status-panel__error" role="alert">{importError}</p> : null}
    </section>
  );
}
