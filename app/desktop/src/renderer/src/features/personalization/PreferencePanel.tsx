import { useEffect, useRef, useState } from "react";
import type {
  DesktopApi,
  PreferenceExportPrepareResult,
  PreferenceProfile,
} from "../../../../shared/contracts";

interface PreferencePanelProps {
  api: DesktopApi | null;
  profile: PreferenceProfile | null;
  loading: boolean;
  loadError: string | null;
  onProfile: (profile: PreferenceProfile) => void;
  onReset: () => void;
}

type ReadyExport = Extract<PreferenceExportPrepareResult, { status: "ready" }>;

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function compactPercent(ppm: number): string {
  return `${Number((ppm / 10_000).toFixed(1))}%`;
}

export function preferenceStatusText(profile: PreferenceProfile): string {
  if (profile.status === "baseline") {
    return "No preference evidence yet. Recommendations use the non-personal baseline.";
  }
  if (profile.status === "learning") {
    return `Learning from ${profile.effectiveEvidenceCount} of ${profile.minimumEvidenceCount} signals. Rankings stay at the non-personal baseline.`;
  }
  return `Personalization active · ${profile.effectiveEvidenceCount} signals · ${compactPercent(profile.preferenceWeightPpm)} weight`;
}

export function PreferencePanel({ api, profile, loading, loadError, onProfile, onReset }: PreferencePanelProps) {
  const [prepared, setPrepared] = useState<ReadyExport | null>(null);
  const [exporting, setExporting] = useState<"prepare" | "confirm" | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreExportFocus = useRef(false);
  const restoreResetFocus = useRef(false);

  useEffect(() => {
    setPrepared(null);
  }, [profile?.revision]);

  useEffect(() => {
    if (exporting !== null || !restoreExportFocus.current) return;
    restoreExportFocus.current = false;
    exportTriggerRef.current?.focus();
  }, [exporting]);

  useEffect(() => {
    if (resetting || !restoreResetFocus.current) return;
    restoreResetFocus.current = false;
    resetTriggerRef.current?.focus();
  }, [resetting]);

  const prepareExport = async () => {
    if (api === null || exporting !== null) return;
    setExporting("prepare");
    setPrepared(null);
    setMessage(null);
    setError(null);
    try {
      const result = await api.preferences.prepareExport();
      if (result.status === "cancelled") {
        setMessage("Preference export cancelled. No file was written.");
      } else if (result.status === "blocked") {
        setError(result.reasons.map((reason) => reason.message).join(" "));
      } else {
        setPrepared(result);
      }
    } catch (prepareError) {
      setError(readableError(prepareError, "Preference export could not be prepared."));
    } finally {
      setExporting(null);
    }
  };

  const confirmExport = async () => {
    if (api === null || prepared === null || exporting !== null) return;
    setExporting("confirm");
    setMessage(null);
    setError(null);
    try {
      const result = await api.preferences.confirmExport(prepared.confirmationId);
      if (result.status === "blocked") {
        setError(result.reasons.map((reason) => reason.message).join(" "));
        return;
      }
      setPrepared(null);
      restoreExportFocus.current = true;
      setMessage(result.overwritten
        ? "Preference export replaced the selected JSON file."
        : "Preference export created a new JSON file.");
    } catch (confirmError) {
      setError(readableError(confirmError, "Preference export could not be confirmed."));
    } finally {
      setExporting(null);
    }
  };

  const reset = async () => {
    if (api === null || resetting) return;
    setResetting(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api.preferences.reset();
      onProfile(result.profile);
      onReset();
      setResetOpen(false);
      restoreResetFocus.current = true;
      setMessage(`Reset ${result.clearedFeedbackCount} feedback events and ${result.clearedRatingCount} ${result.clearedRatingCount === 1 ? "rating" : "ratings"}. Saved filters and personal notes remain.`);
    } catch (resetError) {
      setError(readableError(resetError, "Preferences could not be reset."));
    } finally {
      setResetting(false);
    }
  };

  return (
    <section className="personal-panel preference-panel" aria-labelledby="preference-heading" aria-busy={loading}>
      <div className="personal-panel__heading">
        <div>
          <p className="eyebrow">Transparent learning</p>
          <h2 id="preference-heading">Preference profile</h2>
        </div>
        {profile === null ? null : <span className={`preference-state preference-state--${profile.status}`}>{profile.status}</span>}
      </div>

      {loading && profile === null ? <p className="personal-status" role="status" aria-live="polite">Loading preference profile…</p> : null}
      {profile === null && !loading && loadError === null ? <p className="personal-empty">Preference evidence will appear after a rating or feedback action.</p> : null}
      {profile === null ? null : (
        <>
          <p className="preference-summary">{preferenceStatusText(profile)}</p>
          <dl className="preference-ledger">
            <div><dt>Personal data</dt><dd>{profile.totalPersonalDataCount}</dd></div>
            <div><dt>Effective signals</dt><dd>{profile.effectiveEvidenceCount}</dd></div>
            <div><dt>Threshold</dt><dd>{profile.minimumEvidenceCount}</dd></div>
            <div><dt>Current weight</dt><dd>{compactPercent(profile.preferenceWeightPpm)}</dd></div>
          </dl>

          <details className="preference-evidence">
            <summary>Inspect preference evidence</summary>
            <div className="preference-evidence__columns">
              <section aria-labelledby="track-affinity-heading">
                <h3 id="track-affinity-heading">Track affinities</h3>
                {profile.trackAffinities.length === 0 ? <p>No track affinities yet.</p> : (
                  <ul>{profile.trackAffinities.map((affinity) => (
                    <li key={affinity.trackId}>
                      <strong>{affinity.title ?? "Untitled track"} · {affinity.artist ?? "Unknown artist"}</strong>
                      <span>{compactPercent(affinity.scorePpm)} · {affinity.evidenceCount} signals</span>
                    </li>
                  ))}</ul>
                )}
                {profile.trackAffinitiesTruncated ? <p>Additional track affinities are not shown.</p> : null}
              </section>
              <section aria-labelledby="genre-affinity-heading">
                <h3 id="genre-affinity-heading">Genre affinities</h3>
                {profile.genreAffinities.length === 0 ? <p>No genre affinities yet.</p> : (
                  <ul>{profile.genreAffinities.map((affinity) => (
                    <li key={affinity.genre}>
                      <strong>{affinity.genre}</strong>
                      <span>{compactPercent(affinity.scorePpm)} · {affinity.evidenceCount} signals</span>
                    </li>
                  ))}</ul>
                )}
                {profile.genreAffinitiesTruncated ? <p>Additional genre affinities are not shown.</p> : null}
              </section>
            </div>
          </details>
        </>
      )}

      <div className="personal-actions">
        <button ref={exportTriggerRef} type="button" className="personal-button" disabled={api === null || exporting !== null || profile === null} onClick={() => { void prepareExport(); }}>
          {exporting === "prepare" ? "Preparing preference export…" : "Prepare preference export"}
        </button>
        <button ref={resetTriggerRef} type="button" className="personal-button personal-button--danger" disabled={api === null || resetting || profile === null} onClick={() => setResetOpen(true)}>
          Reset preferences
        </button>
      </div>

      {prepared === null ? null : (
        <div className="personal-confirmation" role="group" aria-label="Confirm preference export">
          <p>{prepared.willReplaceExisting
            ? `${prepared.destinationDisplay} already exists and will be replaced.`
            : `${prepared.destinationDisplay} will be created.`}</p>
          <p>{prepared.effectiveEvidenceCount} effective signals · {prepared.profileStatus} profile</p>
          <div className="personal-actions">
            <button type="button" className="personal-button personal-button--primary" disabled={exporting !== null} onClick={() => { void confirmExport(); }}>
              {exporting === "confirm" ? "Exporting preferences…" : "Confirm preference export"}
            </button>
            <button
              type="button"
              className="personal-button"
              disabled={exporting !== null}
              onClick={() => {
                setPrepared(null);
                exportTriggerRef.current?.focus();
              }}
            >
              Cancel preference export
            </button>
          </div>
        </div>
      )}

      {!resetOpen ? null : (
        <div className="personal-confirmation personal-confirmation--danger" role="group" aria-label="Confirm preference reset">
          <p>This clears ratings and learned feedback. Tags, notes, saved filters, sets, analysis, and the imported library stay intact.</p>
          <div className="personal-actions">
            <button type="button" className="personal-button personal-button--danger" disabled={resetting} onClick={() => { void reset(); }}>
              {resetting ? "Resetting preferences…" : "Confirm preference reset"}
            </button>
            <button
              type="button"
              className="personal-button"
              disabled={resetting}
              onClick={() => {
                setResetOpen(false);
                resetTriggerRef.current?.focus();
              }}
            >
              Keep preferences
            </button>
          </div>
        </div>
      )}

      {message === null ? null : <p className="personal-status personal-status--success" role="status" aria-live="polite">{message}</p>}
      {loadError === null ? null : <p className="personal-status personal-status--error" role="alert">{loadError}{profile === null ? "" : " Showing the last successful profile."}</p>}
      {error === null ? null : <p className="personal-status personal-status--error" role="alert">{error}</p>}
    </section>
  );
}
