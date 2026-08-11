import type { TrackListItem } from "../../../../shared/contracts";

interface TrackTableProps {
  tracks: TrackListItem[] | null;
  loading: boolean;
  nextCursor: string | null;
  loadingMore: boolean;
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

export function TrackTable({ tracks, loading, nextCursor, loadingMore, onLoadMore }: TrackTableProps) {
  return (
    <section className="track-surface" aria-labelledby="track-heading">
      <div className="track-surface__heading">
        <p className="eyebrow">Selection</p>
        <h2 id="track-heading">Tracks</h2>
      </div>
      <table aria-label="Tracks">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Artist</th>
            <th scope="col">BPM</th>
            <th scope="col">Key</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="table-note">Loading tracks…</td></tr>
          ) : tracks !== null && tracks.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty-library">
                <strong>No tracks imported yet</strong>
                <span>Import a Rekordbox XML file to start browsing your library.</span>
              </td>
            </tr>
          ) : tracks?.map((track) => {
            const state = availability(track);
            return (
              <tr key={track.id}>
                <td>{track.title ?? "Untitled track"}</td>
                <td>{track.artist ?? "Unknown artist"}</td>
                <td className="data-cell">{formatBpm(track.bpmMilli)}</td>
                <td className="data-cell">{track.musicalKey ?? "—"}</td>
                <td><span className={`availability availability--${track.availability}`}><span aria-hidden="true">{state.icon}</span>{state.label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
