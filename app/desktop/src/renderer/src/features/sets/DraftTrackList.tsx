import { useState } from "react";
import type { DiscoveryTrack, SetDraftMutationRequest, SetDraftReplacementResult, SetDraftSnapshot } from "../../../../shared/contracts";

export function DraftTrackList({ snapshot, availableTracks, readOnly, onMutate, onFindReplacements }: {
  snapshot: SetDraftSnapshot; availableTracks: DiscoveryTrack[]; readOnly: boolean;
  onMutate: (mutation: SetDraftMutationRequest["mutation"]) => void;
  onFindReplacements: (entryId: string) => Promise<SetDraftReplacementResult | null>;
}) {
  const [replacements, setReplacements] = useState<Record<string, SetDraftReplacementResult>>({});
  return <section aria-labelledby="draft-track-list-title"><h2 id="draft-track-list-title">Draft tracks</h2>
    {snapshot.entries.length === 0 ? <p>No tracks yet. Insert a library track to start this set.</p> : <ol className="draft-track-list" aria-label="Draft tracks">{snapshot.entries.map((entry, index) => {
      const title = entry.track?.title ?? "Missing track";
      return <li key={entry.id}><h3>{title}</h3><p>{entry.bpmMilli ? `${Math.round(entry.bpmMilli / 1000)} BPM` : "BPM unavailable"} · {entry.energyPpm === null ? "Energy unavailable" : `${Math.round(entry.energyPpm / 10_000)}% energy`}</p>
        <div className="set-actions"><button type="button" disabled={readOnly || index === 0} onClick={() => onMutate({ type: "move_entry", entryId: entry.id, toIndex: index - 1 })}>Move {title} up</button><button type="button" disabled={readOnly || index === snapshot.entries.length - 1} onClick={() => onMutate({ type: "move_entry", entryId: entry.id, toIndex: index + 1 })}>Move {title} down</button><button type="button" disabled={readOnly} onClick={() => onMutate({ type: "set_track_pin", entryId: entry.id, pinned: !entry.trackPinned })}>{entry.trackPinned ? "Unpin" : "Pin"} track {title}</button><button type="button" disabled={readOnly} onClick={() => onMutate({ type: "set_position_pin", entryId: entry.id, pinned: !entry.positionPinned })}>{entry.positionPinned ? "Unpin" : "Pin"} position {title}</button><button type="button" disabled={readOnly} onClick={() => onMutate({ type: "ban_entry", entryId: entry.id })}>Ban {title}</button><button type="button" disabled={readOnly} onClick={() => onMutate({ type: "remove_entry", entryId: entry.id })}>Remove {title}</button></div>
        <label>Role for {title}<select disabled={readOnly} value={entry.role ?? ""} onChange={(event) => onMutate({ type: "set_entry_goal", entryId: entry.id, role: event.target.value === "" ? null : event.target.value as typeof entry.role, targetEnergyPpm: entry.targetEnergyPpm })}><option value="">No role</option>{["warmup", "groove", "build", "peak", "singalong", "reset", "bridge", "closer"].map((role) => <option key={role} value={role}>{role}</option>)}</select></label><label>Target energy for {title} (%)<input type="number" min="0" max="100" disabled={readOnly} defaultValue={entry.targetEnergyPpm === null ? "" : Math.round(entry.targetEnergyPpm / 10_000)} onBlur={(event) => { const value = event.target.value === "" ? null : Math.max(0, Math.min(1_000_000, Number(event.target.value) * 10_000)); if (value === null || Number.isFinite(value)) onMutate({ type: "set_entry_goal", entryId: entry.id, role: entry.role, targetEnergyPpm: value }); }} /></label>
        <button type="button" disabled={readOnly} onClick={() => void onFindReplacements(entry.id).then((result) => result && setReplacements((previous) => ({ ...previous, [entry.id]: result })))}>Find replacements for {title}</button>
        {replacements[entry.id]?.items.map((item) => <button type="button" key={item.track.id} disabled={readOnly} onClick={() => onMutate({ type: "replace_entry", entryId: entry.id, replacementTrackId: item.track.id })}>Replace {title} with {item.track.title}</button>)}
      </li>;
    })}</ol>}
    <h3>Insert a track</h3>{availableTracks.length === 0 ? <p>No currently loaded tracks are available to insert.</p> : availableTracks.slice(0, 10).map((track) => <button type="button" key={track.id} disabled={readOnly} onClick={() => onMutate({ type: "insert_track", trackId: track.id, toIndex: snapshot.entries.length })}>Insert {track.title}</button>)}
    {snapshot.bans.length > 0 && <section aria-label="Banned tracks"><h3>Banned tracks</h3>{snapshot.bans.map((trackId) => <button key={trackId} type="button" disabled={readOnly} onClick={() => onMutate({ type: "unban_track", trackId })}>Unban {trackId}</button>)}</section>}
  </section>;
}
