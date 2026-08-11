import { useEffect, useRef, useState } from "react";
import type { DesktopApi, SavedFilter, TrackFilters } from "../../../../shared/contracts";

interface SavedFiltersPanelProps {
  api: DesktopApi | null;
  currentFilters: TrackFilters;
  onLoad: (filters: TrackFilters) => Promise<void>;
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function SavedFiltersPanel({ api, currentFilters, onLoad }: SavedFiltersPanelProps) {
  const [items, setItems] = useState<SavedFilter[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const restoreNameFocus = useRef(false);

  useEffect(() => {
    if (action !== null || !restoreNameFocus.current) return;
    restoreNameFocus.current = false;
    nameInputRef.current?.focus();
  }, [action]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    let active = true;
    setLoading(true);
    setError(null);
    if (api === null) {
      setLoading(false);
      setError("The secure desktop connection is unavailable.");
      return () => { active = false; };
    }
    void api.library.listSavedFilters()
      .then((result) => {
        if (active && sequence === requestSequence.current) setItems(result.items);
      })
      .catch((loadError: unknown) => {
        if (active && sequence === requestSequence.current) {
          setError(`${readableError(loadError, "Saved filters could not be loaded.")} Existing filter results are unchanged.`);
        }
      })
      .finally(() => {
        if (active && sequence === requestSequence.current) setLoading(false);
      });
    return () => {
      active = false;
      requestSequence.current += 1;
    };
  }, [api]);

  const save = async () => {
    const trimmedName = name.trim();
    if (api === null || trimmedName === "" || action !== null) return;
    setAction("save");
    setMessage(null);
    setError(null);
    try {
      const result = await api.library.saveSavedFilter({ name: trimmedName, filters: currentFilters });
      setItems((current) => [...current.filter((item) => item.id !== result.id), result]);
      setName("");
      setMessage(`Saved ${result.name}.`);
    } catch (saveError) {
      setError(readableError(saveError, "The current filter could not be saved."));
    } finally {
      setAction(null);
    }
  };

  const load = async (item: SavedFilter) => {
    if (action !== null) return;
    setAction(`load:${item.id}`);
    setMessage(null);
    setError(null);
    try {
      await onLoad(item.filters);
      setMessage(`Loaded ${item.name}.`);
    } catch (loadError) {
      setError(readableError(loadError, "The saved filter could not be loaded."));
    } finally {
      setAction(null);
    }
  };

  const remove = async (item: SavedFilter) => {
    if (api === null || action !== null) return;
    setAction(`delete:${item.id}`);
    setMessage(null);
    setError(null);
    try {
      await api.library.deleteSavedFilter(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setMessage(`Deleted ${item.name}.`);
      restoreNameFocus.current = true;
    } catch (deleteError) {
      setError(readableError(deleteError, "The saved filter could not be deleted."));
    } finally {
      setAction(null);
    }
  };

  return (
    <section className="personal-panel saved-filters-panel" aria-labelledby="saved-filters-heading" aria-busy={loading}>
      <div className="personal-panel__heading">
        <div>
          <p className="eyebrow">Recall a crate view</p>
          <h2 id="saved-filters-heading">Saved filters</h2>
        </div>
        <p className="personal-counter">{items.length}/50 saved</p>
      </div>

      <div className="saved-filter-create">
        <label className="personal-field">
          <span>Filter name</span>
          <input
            ref={nameInputRef}
            type="text"
            maxLength={80}
            value={name}
            disabled={loading || action !== null}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="personal-button personal-button--primary"
          disabled={loading || action !== null || api === null || name.trim() === ""}
          onClick={() => { void save(); }}
        >
          {action === "save" ? "Saving current filter…" : "Save current filter"}
        </button>
      </div>

      {loading ? <p className="personal-status" role="status" aria-live="polite">Loading saved filters…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="personal-empty">No saved filters yet. Apply a useful view and name it here.</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="saved-filter-list" aria-label="Saved library filters">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>{Object.keys(item.filters).length} active fields</span>
              </div>
              <div className="personal-actions">
                <button type="button" className="personal-button" disabled={action !== null} onClick={() => { void load(item); }}>
                  {action === `load:${item.id}` ? `Loading ${item.name}…` : `Load ${item.name}`}
                </button>
                <button type="button" className="personal-button personal-button--danger" disabled={action !== null || api === null} onClick={() => { void remove(item); }}>
                  {action === `delete:${item.id}` ? `Deleting ${item.name}…` : `Delete ${item.name}`}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {message === null ? null : <p className="personal-status personal-status--success" role="status" aria-live="polite">{message}</p>}
      {error === null ? null : <p className="personal-status personal-status--error" role="alert">{error}</p>}
    </section>
  );
}
