import { Fragment } from "react";
import type { TrackListItem } from "../../../../shared/contracts";
import { FeatureEvidence } from "../analysis/FeatureEvidence";

const MAX_ANALYSIS_SELECTION = 200;

interface TrackTableProps {
  tracks: TrackListItem[] | null;
  loading: boolean;
  filtered: boolean;
  truncated: boolean;
  loadError: string | null;
  nextCursor: string | null;
  loadingMore: boolean;
  selectedTrackIds: ReadonlySet<string>;
  onToggleTrack: (trackId: string, selected: boolean) => void;
  onToggleAll: (trackIds: string[], selected: boolean) => void;
  onExplore: (track: TrackListItem) => void;
  onLoadMore: () => void;
}

function formatBpm(bpmMilli: number | null): string {
  return bpmMilli === null ? "—" : (bpmMilli / 1_000).toFixed(bpmMilli % 1_000 === 0 ? 0 : 1);
}

function availability(track: TrackListItem) {
  if (track.availability === "missing") return { icon: "⚠", label: "Missing" };
  if (track.availability === "unreadable") return { icon: "×", label: "Unreadable" };
  return { icon: "●", label: "Available" };
}

function trackTitle(track: TrackListItem): string {
  return track.title ?? "Untitled track";
}

function analysisState(track: TrackListItem): string {
  const analysis = track.analysis;
  if (analysis === null || analysis.status === "not_queued") return "Not analyzed";
  if (analysis.status === "queued") return "Queued";
  if (analysis.status === "running") return `Running ${Math.round(analysis.progressPpm / 10_000)}%`;
  if (analysis.status === "paused") return `Paused ${Math.round(analysis.progressPpm / 10_000)}%`;
  if (analysis.status === "succeeded") return "Analyzed";
  return "Failed";
}

function localBpm(track: TrackListItem): string {
  const value = track.analysis?.features?.bpmMilli;
  if (value === undefined) return "—";
  if (value === null) return "Not enough evidence";
  return formatBpm(value);
}

function localKey(track: TrackListItem): string {
  const features = track.analysis?.features;
  if (features === undefined || features === null) return "—";
  if (features.musicalKey === null) return "Not enough evidence";
  return features.mode === null ? features.musicalKey : `${features.musicalKey} ${features.mode}`;
}

export function TrackTable({
  tracks,
  loading,
  filtered,
  truncated,
  loadError,
  nextCursor,
  loadingMore,
  selectedTrackIds,
  onToggleTrack,
  onToggleAll,
  onExplore,
  onLoadMore,
}: TrackTableProps) {
  const selectableIds = (tracks ?? [])
    .filter((track) => track.availability === "available")
    .slice(0, MAX_ANALYSIS_SELECTION)
    .map((track) => track.id);
  const selectedOnPage = selectableIds.filter((trackId) => selectedTrackIds.has(trackId));
  const allSelected = selectableIds.length > 0 && selectedOnPage.length === selectableIds.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;

  return (
    <section className="track-surface" aria-labelledby="track-heading">
      <div className="track-surface__heading">
        <p className="eyebrow">Selection</p>
        <h2 id="track-heading">Tracks</h2>
      </div>
      <div className="track-table-scroll">
        <table className="track-table" aria-label="Tracks">
          <thead>
            <tr>
              <th scope="col" className="selection-column">
                <label className="selection-control">
                  <span className="sr-only">Select all analyzable tracks</span>
                  <input
                    type="checkbox"
                    aria-label="Select all analyzable tracks"
                    aria-checked={someSelected ? "mixed" : allSelected}
                    checked={allSelected}
                    disabled={loading || selectableIds.length === 0}
                    onChange={(event) => onToggleAll(selectableIds, event.currentTarget.checked)}
                  />
                </label>
              </th>
              <th scope="col">Title</th>
              <th scope="col">Artist</th>
              <th scope="col">Imported BPM</th>
              <th scope="col">Local BPM</th>
              <th scope="col">Imported key</th>
              <th scope="col">Local key</th>
              <th scope="col">Status</th>
              <th scope="col">Discover</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="table-note">Loading tracks…</td></tr>
            ) : loadError !== null ? (
              <tr>
                <td colSpan={9} className="empty-library empty-library--error">
                  <strong>Tracks could not be loaded</strong>
                  <span>Keep the current playlist and filters, then try again.</span>
                </td>
              </tr>
            ) : tracks !== null && tracks.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-library">
                  <strong>{filtered ? "No tracks match these filters" : "No tracks imported yet"}</strong>
                  <span>{filtered
                    ? "Try broader values or clear the filters."
                    : "Import a Rekordbox XML file to start browsing your library."}</span>
                </td>
              </tr>
            ) : tracks?.map((track, occurrenceIndex) => {
              const state = availability(track);
              const title = trackTitle(track);
              const isSelected = selectedTrackIds.has(track.id);
              const selectionLimitReached = selectedTrackIds.size >= MAX_ANALYSIS_SELECTION && !isSelected;
              const features = track.analysis?.status === "succeeded" ? track.analysis.features : null;
              const failedMessage = track.analysis?.status === "failed" ? track.analysis.errorMessage : null;
              return (
                <Fragment key={`${track.id}:${occurrenceIndex}`}>
                  <tr>
                    <td className="selection-column">
                      {track.availability === "available" ? (
                        <label className="selection-control">
                          <span className="sr-only">Select {title} for analysis</span>
                          <input
                            type="checkbox"
                            aria-label={`Select ${title} for analysis`}
                            checked={isSelected}
                            disabled={selectionLimitReached}
                            onChange={(event) => onToggleTrack(track.id, event.currentTarget.checked)}
                          />
                        </label>
                      ) : <span className="selection-unavailable" aria-hidden="true">—</span>}
                    </td>
                    <td>{title}</td>
                    <td>{track.artist ?? "Unknown artist"}</td>
                    <td className="data-cell">{formatBpm(track.bpmMilli)}</td>
                    <td className="data-cell">{localBpm(track)}</td>
                    <td className="data-cell">{track.musicalKey ?? "—"}</td>
                    <td className="data-cell">{localKey(track)}</td>
                    <td>
                      <span className={`availability availability--${track.availability}`}>
                        <span aria-hidden="true">{state.icon}</span>{state.label}
                      </span>
                      <span className={`analysis-state analysis-state--${track.analysis?.status ?? "not_queued"}`}>{analysisState(track)}</span>
                    </td>
                    <td className="discovery-column">
                      <button type="button" className="explore-button" aria-label={`Explore ${title}`} onClick={() => onExplore(track)}>
                        Explore
                      </button>
                    </td>
                  </tr>
                  {features !== null ? (
                    <tr className="evidence-row" aria-label="Analysis evidence">
                      <td colSpan={9}><FeatureEvidence features={features} trackTitle={title} /></td>
                    </tr>
                  ) : null}
                  {failedMessage !== null ? (
                    <tr className="analysis-error-row" aria-label="Analysis error">
                      <td colSpan={9}><p><strong>Analysis failed:</strong> {failedMessage}</p></td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {truncated ? (
        <p className="track-surface__truncated" role="status">Showing results from the first 25,000 scanned tracks.</p>
      ) : null}
      {nextCursor !== null ? (
        <div className="track-surface__more">
          <button type="button" className="load-more-button" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading more tracks…" : "Load more tracks"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
