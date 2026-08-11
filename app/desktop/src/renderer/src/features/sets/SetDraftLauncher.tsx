import { useEffect, useState } from "react";
import type { DesktopApi, DiscoveryIntent, SetDraftSnapshot } from "../../../../shared/contracts";
import { SetInspectionPanel } from "./SetInspectionPanel";

export interface SetDraftLauncherProps {
  api: DesktopApi | null;
  selectedTrackIds: string[];
  playlistId: string | null;
  seedTrackId: string | null;
  onOpen(snapshot: SetDraftSnapshot): void;
}

const INTENTS: readonly [DiscoveryIntent, string][] = [
  ["smooth", "Smooth"], ["build", "Build"], ["peak", "Peak"], ["reset", "Reset"],
  ["genre_shift", "Genre shift"], ["adventurous", "Adventurous"],
  ["singalong_continuation", "Singalong continuation"], ["closer", "Closer"],
];

export function SetDraftLauncher({ api, selectedTrackIds, playlistId, seedTrackId, onOpen }: SetDraftLauncherProps) {
  const [title, setTitle] = useState("New set");
  const [intent, setIntent] = useState<DiscoveryIntent>("smooth");
  const [targetMinutes, setTargetMinutes] = useState("");
  const [maxArtistRepeats, setMaxArtistRepeats] = useState("");
  const [saved, setSaved] = useState<{ draftId: string; title: string }[]>([]);
  const [savedId, setSavedId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api.sets.list().then((result) => { if (active) { setSaved(result.items); setSavedId(result.items[0]?.draftId ?? ""); } }).catch(() => active && setMessage("Saved sets could not be loaded."));
    return () => { active = false; };
  }, [api]);

  async function create(source: Parameters<DesktopApi["sets"]["create"]>[0]["source"]) {
    if (!api) { setMessage("Set tools are unavailable."); return; }
    setBusy(true); setMessage(null);
    const parsedMinutes = targetMinutes === "" ? null : Number(targetMinutes);
    const parsedRepeats = maxArtistRepeats === "" ? null : Number(maxArtistRepeats);
    if ((parsedMinutes !== null && (!Number.isFinite(parsedMinutes) || parsedMinutes < 15 || parsedMinutes > 480)) || (parsedRepeats !== null && (!Number.isInteger(parsedRepeats) || parsedRepeats < 1 || parsedRepeats > 20))) {
      setMessage("Use a duration from 15 to 480 minutes and an artist cap from 1 to 20."); setBusy(false); return;
    }
    const plan = { intent, targetDurationMs: parsedMinutes === null ? null : Math.round(parsedMinutes * 60_000), maxArtistRepeats: parsedRepeats, candidateFilters: {} };
    try { onOpen(await api.sets.create({ title: title.trim() || "New set", plan, source })); }
    catch { setMessage("The set could not be created. Try again."); }
    finally { setBusy(false); }
  }

  async function openSaved() {
    if (!api || !savedId) return;
    setBusy(true); setMessage(null);
    try { onOpen(await api.sets.get({ draftId: savedId })); }
    catch { setMessage("The saved set could not be opened."); }
    finally { setBusy(false); }
  }

  return <section className="set-launcher" aria-labelledby="set-launcher-title">
    <h2 id="set-launcher-title">Set drafts</h2>
    <p>Create a draft without changing Rekordbox.</p>
    <label>Set title <input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>Set intent <select aria-label="Set intent" value={intent} onChange={(event) => setIntent(event.target.value as DiscoveryIntent)}>{INTENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Target duration (minutes) <input aria-label="Target duration (minutes)" type="number" min="15" max="480" value={targetMinutes} onChange={(event) => setTargetMinutes(event.target.value)} /></label>
    <label>Maximum artist repeats <input aria-label="Maximum artist repeats" type="number" min="1" max="20" value={maxArtistRepeats} onChange={(event) => setMaxArtistRepeats(event.target.value)} /></label>
    <div className="set-actions">
      <button type="button" disabled={busy} onClick={() => void create({ kind: "empty" })}>Create empty set</button>
      <button type="button" disabled={busy || selectedTrackIds.length === 0} onClick={() => void create({ kind: "tracks", trackIds: selectedTrackIds })}>Create from selected tracks</button>
      <button type="button" disabled={busy || playlistId === null} onClick={() => playlistId && void create({ kind: "playlist", playlistId })}>Create from playlist</button>
      <button type="button" disabled={busy} onClick={() => void create(seedTrackId ? { kind: "generated", seedTrackId, maxTracks: 12 } : { kind: "generated", maxTracks: 12 })}>Generate from seed</button>
    </div>
    <label>Saved sets <select aria-label="Saved sets" value={savedId} onChange={(event) => setSavedId(event.target.value)}><option value="">Select a saved set</option>{saved.map((item) => <option key={item.draftId} value={item.draftId}>{item.title}</option>)}</select></label>
    <button type="button" disabled={busy || !savedId} onClick={() => void openSaved()}>Open saved set</button>
    {message && <p role="status">{message}</p>}
    {playlistId && <SetInspectionPanel api={api} request={{ kind: "playlist", playlistId }} buttonLabel="Inspect selected playlist" />}
  </section>;
}
