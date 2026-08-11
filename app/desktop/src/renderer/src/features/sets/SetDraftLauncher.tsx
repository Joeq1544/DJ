import { useEffect, useState } from "react";
import type { DesktopApi, DiscoveryIntent, SetDraftSnapshot } from "../../../../shared/contracts";

export interface SetDraftLauncherProps {
  api: DesktopApi | null;
  selectedTrackIds: string[];
  playlistId: string | null;
  seedTrackId: string | null;
  onOpen(snapshot: SetDraftSnapshot): void;
}

const plan = (intent: DiscoveryIntent) => ({ intent, targetDurationMs: null, maxArtistRepeats: null, candidateFilters: {} });

export function SetDraftLauncher({ api, selectedTrackIds, playlistId, seedTrackId, onOpen }: SetDraftLauncherProps) {
  const [title, setTitle] = useState("New set");
  const [intent, setIntent] = useState<DiscoveryIntent>("smooth");
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
    try { onOpen(await api.sets.create({ title: title.trim() || "New set", plan: plan(intent), source })); }
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
    <label>Set intent <select value={intent} onChange={(event) => setIntent(event.target.value as DiscoveryIntent)}><option value="smooth">Smooth</option><option value="build">Build</option><option value="energy">Energy</option><option value="variety">Variety</option></select></label>
    <div className="set-actions">
      <button type="button" disabled={busy} onClick={() => void create({ kind: "empty" })}>Create empty set</button>
      <button type="button" disabled={busy || selectedTrackIds.length === 0} onClick={() => void create({ kind: "tracks", trackIds: selectedTrackIds })}>Create from selected tracks</button>
      <button type="button" disabled={busy || playlistId === null} onClick={() => playlistId && void create({ kind: "playlist", playlistId })}>Create from playlist</button>
      <button type="button" disabled={busy} onClick={() => void create(seedTrackId ? { kind: "generated", seedTrackId, maxTracks: 12 } : { kind: "generated", maxTracks: 12 })}>Generate from seed</button>
    </div>
    <label>Saved sets <select aria-label="Saved sets" value={savedId} onChange={(event) => setSavedId(event.target.value)}><option value="">Select a saved set</option>{saved.map((item) => <option key={item.draftId} value={item.draftId}>{item.title}</option>)}</select></label>
    <button type="button" disabled={busy || !savedId} onClick={() => void openSaved()}>Open saved set</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
