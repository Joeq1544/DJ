import { useEffect, useState, type FormEvent } from "react";
import type { TrackFilters } from "../../../../shared/contracts";

type AnalysisState = NonNullable<TrackFilters["analysisState"]>;
type Availability = NonNullable<TrackFilters["availability"]>;
type KeyRelation = NonNullable<TrackFilters["keyRelation"]>;

interface FilterDraft {
  text: string;
  bpmMin: string;
  bpmMax: string;
  musicalKey: string;
  keyRelation: KeyRelation;
  genre: string;
  ratingMin: string;
  tag: string;
  energyMin: string;
  energyMax: string;
  analysisState: AnalysisState;
  availability: Availability;
}

interface DiscoveryFiltersProps {
  activeFilters: TrackFilters;
  loading: boolean;
  onApply: (filters: TrackFilters) => void;
  onClear: () => void;
}

function draftFromFilters(filters: TrackFilters): FilterDraft {
  return {
    text: filters.text ?? "",
    bpmMin: filters.bpmMinMilli === undefined ? "" : String(filters.bpmMinMilli / 1_000),
    bpmMax: filters.bpmMaxMilli === undefined ? "" : String(filters.bpmMaxMilli / 1_000),
    musicalKey: filters.musicalKey ?? "",
    keyRelation: filters.keyRelation ?? "compatible",
    genre: filters.genre ?? "",
    ratingMin: filters.ratingMin === undefined ? "" : String(filters.ratingMin),
    tag: filters.tag ?? "",
    energyMin: filters.energyMinPpm === undefined ? "" : String(filters.energyMinPpm / 10_000),
    energyMax: filters.energyMaxPpm === undefined ? "" : String(filters.energyMaxPpm / 10_000),
    analysisState: filters.analysisState ?? "any",
    availability: filters.availability ?? "any",
  };
}

function scaledInteger(value: string, scale: number): number | undefined {
  if (value.trim() === "") return undefined;
  return Math.round(Number(value) * scale);
}

function filtersFromDraft(draft: FilterDraft): TrackFilters {
  const filters: TrackFilters = {};
  const text = draft.text.trim();
  const musicalKey = draft.musicalKey.trim();
  const genre = draft.genre.trim();
  const tag = draft.tag.normalize("NFKC").trim();
  const bpmMinMilli = scaledInteger(draft.bpmMin, 1_000);
  const bpmMaxMilli = scaledInteger(draft.bpmMax, 1_000);
  const energyMinPpm = scaledInteger(draft.energyMin, 10_000);
  const energyMaxPpm = scaledInteger(draft.energyMax, 10_000);

  if (text !== "") filters.text = text;
  if (bpmMinMilli !== undefined) filters.bpmMinMilli = bpmMinMilli;
  if (bpmMaxMilli !== undefined) filters.bpmMaxMilli = bpmMaxMilli;
  if (musicalKey !== "") {
    filters.musicalKey = musicalKey;
    filters.keyRelation = draft.keyRelation;
  }
  if (genre !== "") filters.genre = genre;
  if (draft.ratingMin !== "") filters.ratingMin = Number(draft.ratingMin);
  if (tag !== "") filters.tag = tag;
  if (energyMinPpm !== undefined) filters.energyMinPpm = energyMinPpm;
  if (energyMaxPpm !== undefined) filters.energyMaxPpm = energyMaxPpm;
  if (draft.analysisState !== "any") filters.analysisState = draft.analysisState;
  if (draft.availability !== "any") filters.availability = draft.availability;
  return filters;
}

function rangeError(filters: TrackFilters): string | null {
  if (
    filters.bpmMinMilli !== undefined &&
    filters.bpmMaxMilli !== undefined &&
    filters.bpmMinMilli > filters.bpmMaxMilli
  ) {
    return "Minimum BPM must not exceed maximum BPM.";
  }
  if (
    filters.energyMinPpm !== undefined &&
    filters.energyMaxPpm !== undefined &&
    filters.energyMinPpm > filters.energyMaxPpm
  ) {
    return "Minimum energy must not exceed maximum energy.";
  }
  if (filters.tag !== undefined && filters.tag.length > 40) {
    return "An exact tag must be 40 characters or fewer.";
  }
  return null;
}

export function DiscoveryFilters({ activeFilters, loading, onApply, onClear }: DiscoveryFiltersProps) {
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromFilters(activeFilters));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(draftFromFilters(activeFilters));
  }, [activeFilters]);

  const update = <Key extends keyof FilterDraft>(key: Key, value: FilterDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    const filters = filtersFromDraft(draft);
    const nextError = rangeError(filters);
    if (nextError !== null) {
      setError(nextError);
      return;
    }
    setError(null);
    onApply(filters);
  };

  const clear = () => {
    if (loading) return;
    setDraft(draftFromFilters({}));
    setError(null);
    onClear();
  };

  const activeCount = Object.keys(activeFilters).length;
  const hasBpmError = error?.includes("BPM") === true;
  const hasEnergyError = error?.includes("energy") === true;

  return (
    <section className="discovery-filters" aria-labelledby="library-filters-heading">
      <div className="discovery-filters__heading">
        <div>
          <p className="eyebrow">Find a cue</p>
          <h2 id="library-filters-heading">Library filters</h2>
        </div>
        <p className="discovery-filters__status" role="status" aria-live="polite">
          {activeCount === 0 ? "No filters applied" : `${activeCount} ${activeCount === 1 ? "filter" : "filters"} applied`}
        </p>
      </div>

      <form className="filter-form" aria-describedby={error === null ? undefined : "filter-form-error"} onSubmit={submit}>
        <label className="filter-field filter-field--search">
          <span>Search library</span>
          <input
            type="search"
            maxLength={200}
            value={draft.text}
            onChange={(event) => update("text", event.currentTarget.value)}
            placeholder="Title, artist, album, genre, tag, or note"
          />
        </label>

        <fieldset className="filter-group">
          <legend>Tempo</legend>
          <label className="filter-field">
            <span>Minimum BPM</span>
            <input
              type="number"
              min={30}
              max={400}
              step="0.001"
              inputMode="decimal"
              aria-invalid={hasBpmError}
              value={draft.bpmMin}
              onChange={(event) => update("bpmMin", event.currentTarget.value)}
            />
          </label>
          <label className="filter-field">
            <span>Maximum BPM</span>
            <input
              type="number"
              min={30}
              max={400}
              step="0.001"
              inputMode="decimal"
              aria-invalid={hasBpmError}
              value={draft.bpmMax}
              onChange={(event) => update("bpmMax", event.currentTarget.value)}
            />
          </label>
        </fieldset>

        <fieldset className="filter-group">
          <legend>Key</legend>
          <label className="filter-field">
            <span>Musical key</span>
            <input
              type="text"
              maxLength={64}
              value={draft.musicalKey}
              onChange={(event) => update("musicalKey", event.currentTarget.value)}
              placeholder="8A or C minor"
            />
          </label>
          <label className="filter-field">
            <span>Key relation</span>
            <select
              value={draft.keyRelation}
              disabled={draft.musicalKey.trim() === ""}
              onChange={(event) => update("keyRelation", event.currentTarget.value as KeyRelation)}
            >
              <option value="exact">Exact</option>
              <option value="compatible">Compatible</option>
            </select>
          </label>
        </fieldset>

        <label className="filter-field">
          <span>Genre</span>
          <input
            type="text"
            maxLength={200}
            value={draft.genre}
            onChange={(event) => update("genre", event.currentTarget.value)}
            placeholder="House"
          />
        </label>

        <label className="filter-field">
          <span>Minimum rating</span>
          <select
            value={draft.ratingMin}
            onChange={(event) => update("ratingMin", event.currentTarget.value)}
          >
            <option value="">Any rating</option>
            <option value="1">1 star or more</option>
            <option value="2">2 stars or more</option>
            <option value="3">3 stars or more</option>
            <option value="4">4 stars or more</option>
            <option value="5">5 stars</option>
          </select>
        </label>

        <label className="filter-field">
          <span>Exact tag</span>
          <input
            type="text"
            maxLength={40}
            value={draft.tag}
            onChange={(event) => update("tag", event.currentTarget.value)}
            placeholder="Warm"
          />
        </label>

        <fieldset className="filter-group">
          <legend>Energy</legend>
          <label className="filter-field">
            <span>Minimum energy (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              inputMode="decimal"
              aria-invalid={hasEnergyError}
              value={draft.energyMin}
              onChange={(event) => update("energyMin", event.currentTarget.value)}
            />
          </label>
          <label className="filter-field">
            <span>Maximum energy (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              inputMode="decimal"
              aria-invalid={hasEnergyError}
              value={draft.energyMax}
              onChange={(event) => update("energyMax", event.currentTarget.value)}
            />
          </label>
        </fieldset>

        <label className="filter-field">
          <span>Analysis state</span>
          <select
            value={draft.analysisState}
            onChange={(event) => update("analysisState", event.currentTarget.value as AnalysisState)}
          >
            <option value="any">Any analysis state</option>
            <option value="analyzed">Analyzed</option>
            <option value="not_analyzed">Not analyzed</option>
            <option value="failed">Failed</option>
          </select>
        </label>

        <label className="filter-field">
          <span>Availability</span>
          <select
            value={draft.availability}
            onChange={(event) => update("availability", event.currentTarget.value as Availability)}
          >
            <option value="any">Any availability</option>
            <option value="available">Available</option>
            <option value="missing">Missing</option>
            <option value="unreadable">Unreadable</option>
          </select>
        </label>

        <div className="filter-form__actions">
          <button type="submit" className="filter-button filter-button--primary" disabled={loading}>
            {loading ? "Filtering…" : "Apply filters"}
          </button>
          <button type="button" className="filter-button" disabled={loading || activeCount === 0} onClick={clear}>
            Clear filters
          </button>
        </div>
      </form>

      {error !== null ? <p id="filter-form-error" className="filter-form__error" role="alert">{error}</p> : null}
    </section>
  );
}
