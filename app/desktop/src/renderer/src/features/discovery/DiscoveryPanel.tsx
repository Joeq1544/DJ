import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  DesktopApi,
  DiscoveryCandidate,
  DiscoveryIntent,
  RecommendationResponse,
  ScoreComponent,
  SimilarityResponse,
  TrackFilters,
} from "../../../../shared/contracts";

type DiscoveryMode = "similar" | "next";

export interface DiscoverySeed {
  id: string;
  title: string;
  artist: string;
}

interface DiscoveryPanelProps {
  api: DesktopApi | null;
  seed: DiscoverySeed;
  filters: TrackFilters;
}

const INTENTS: ReadonlyArray<{ value: DiscoveryIntent; label: string }> = [
  { value: "smooth", label: "Smooth" },
  { value: "build", label: "Build" },
  { value: "peak", label: "Peak" },
  { value: "reset", label: "Reset" },
  { value: "genre_shift", label: "Genre shift" },
  { value: "adventurous", label: "Adventurous" },
  { value: "singalong_continuation", label: "Singalong continuation" },
  { value: "closer", label: "Closer" },
];

const COMPONENT_LABELS: Record<ScoreComponent["name"], string> = {
  tempo: "Tempo",
  key: "Key",
  energy: "Energy",
  style: "Style",
  timbre: "Timbre",
  vocal: "Vocal",
  structure: "Structure",
  preference: "Preference",
};

const EFFECT_LABELS: Record<ScoreComponent["effect"], string> = {
  bonus: "Bonus",
  penalty: "Penalty",
  neutral: "Neutral",
  missing: "Missing evidence",
};

function wholePercent(ppm: number): number {
  return Math.round(ppm / 10_000);
}

function signedPercent(ppm: number): string {
  const magnitude = wholePercent(Math.abs(ppm));
  if (ppm > 0) return `+${magnitude}%`;
  if (ppm < 0) return `−${magnitude}%`;
  return "0%";
}

function displayTitle(candidate: DiscoveryCandidate): string {
  return candidate.track.title ?? "Untitled track";
}

function CandidateCard({ candidate, index }: { candidate: DiscoveryCandidate; index: number }) {
  const title = displayTitle(candidate);
  const titleId = `discovery-candidate-${index}-title`;
  return (
    <li className="discovery-candidate" aria-labelledby={titleId}>
      <div className="discovery-candidate__header">
        <div>
          <h3 id={titleId}>{title}</h3>
          <p>{candidate.track.artist ?? "Unknown artist"}</p>
        </div>
        <div className="discovery-candidate__metrics" aria-label={`Scores for ${title}`}>
          <span>Score {wholePercent(candidate.scorePpm)}%</span>
          <span>Confidence {wholePercent(candidate.confidencePpm)}%</span>
        </div>
      </div>

      <p className="discovery-candidate__metadata">
        {candidate.track.bpmMilli === null ? "BPM unavailable" : `${candidate.track.bpmMilli / 1_000} BPM`}
        <span aria-hidden="true"> · </span>
        {candidate.track.musicalKey ?? "Key unavailable"}
        <span aria-hidden="true"> · </span>
        {candidate.track.genre ?? "Genre unavailable"}
      </p>

      <ul className="discovery-reasons" aria-label={`Why ${title}`}>
        {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>

      <details className="score-details">
        <summary>Score evidence for {title}</summary>
        <ul className="score-components">
          {candidate.components.map((component) => (
            <li key={component.name} className={`score-component score-component--${component.effect}`}>
              <div className="score-component__identity">
                <strong>{COMPONENT_LABELS[component.name]}</strong>
                <span className="score-component__effect">{EFFECT_LABELS[component.effect]}</span>
              </div>
              <p>{component.reason}</p>
              <p className="score-component__numbers">
                {component.scorePpm === null ? "No score" : `${wholePercent(component.scorePpm)}% score`}
                <span aria-hidden="true"> · </span>
                {wholePercent(component.weightPpm)}% weight
                <span aria-hidden="true"> · </span>
                {signedPercent(component.contributionSignedPpm)} contribution
              </p>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function responseSummary(result: SimilarityResponse | RecommendationResponse): string {
  const count = result.items.length;
  return `${count} ${count === 1 ? "candidate" : "candidates"} · ${result.scannedCount.toLocaleString()} tracks scanned`;
}

export function DiscoveryPanel({ api, seed, filters }: DiscoveryPanelProps) {
  const [mode, setMode] = useState<DiscoveryMode>("similar");
  const [intent, setIntent] = useState<DiscoveryIntent>("smooth");
  const [similarResult, setSimilarResult] = useState<SimilarityResponse | null>(null);
  const [recommendationResult, setRecommendationResult] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestNonce, setRequestNonce] = useState(0);
  const requestSequence = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const similarTabRef = useRef<HTMLButtonElement>(null);
  const nextTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [seed.id]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    let active = true;
    setLoading(true);
    setError(null);

    if (api === null) {
      setLoading(false);
      setError("The secure desktop connection is unavailable.");
      return () => {
        active = false;
      };
    }

    const requestFilters = Object.keys(filters).length === 0 ? undefined : filters;
    const request = mode === "similar"
      ? api.discovery.findSimilar({
          seedTrackId: seed.id,
          ...(requestFilters === undefined ? {} : { filters: requestFilters }),
          limit: 10,
        })
      : api.discovery.recommendNext({
          seedTrackId: seed.id,
          intent,
          ...(requestFilters === undefined ? {} : { filters: requestFilters }),
          limit: 10,
        });

    void request
      .then((result) => {
        if (!active || sequence !== requestSequence.current) return;
        if (mode === "similar") setSimilarResult(result as SimilarityResponse);
        else setRecommendationResult(result as RecommendationResponse);
      })
      .catch(() => {
        if (!active || sequence !== requestSequence.current) return;
        setError(mode === "similar"
          ? "Similar tracks could not be loaded."
          : "Next-track recommendations could not be loaded.");
      })
      .finally(() => {
        if (!active || sequence !== requestSequence.current) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api, filters, intent, mode, requestNonce, seed.id]);

  const result = mode === "similar" ? similarResult : recommendationResult;
  const tabId = mode === "similar" ? "discovery-tab-similar" : "discovery-tab-next";

  const chooseMode = (nextMode: DiscoveryMode, moveFocus = false) => {
    setMode(nextMode);
    setError(null);
    if (moveFocus) {
      if (nextMode === "similar") similarTabRef.current?.focus();
      else nextTabRef.current?.focus();
    }
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      chooseMode(mode === "similar" ? "next" : "similar", true);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      chooseMode("similar", true);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      chooseMode("next", true);
    }
  };

  const retryLabel = mode === "similar" ? "Retry similar tracks" : "Retry next-track recommendations";

  return (
    <section className="discovery-panel" aria-labelledby="discovery-heading">
      <header className="discovery-panel__header">
        <div>
          <p className="eyebrow">Current seed</p>
          <h2 id="discovery-heading" ref={headingRef} tabIndex={-1}>Explore {seed.title}</h2>
          <p className="discovery-panel__seed">{seed.artist}</p>
        </div>
        <div className="discovery-tabs" role="tablist" aria-label="Discovery mode">
          <button
            id="discovery-tab-similar"
            ref={similarTabRef}
            type="button"
            role="tab"
            aria-selected={mode === "similar"}
            aria-controls="discovery-results"
            tabIndex={mode === "similar" ? 0 : -1}
            onClick={() => chooseMode("similar")}
            onKeyDown={onTabKeyDown}
          >
            Similar
          </button>
          <button
            id="discovery-tab-next"
            ref={nextTabRef}
            type="button"
            role="tab"
            aria-selected={mode === "next"}
            aria-controls="discovery-results"
            tabIndex={mode === "next" ? 0 : -1}
            onClick={() => chooseMode("next")}
            onKeyDown={onTabKeyDown}
          >
            Next
          </button>
        </div>
      </header>

      <div
        id="discovery-results"
        className="discovery-panel__body"
        role="tabpanel"
        aria-labelledby={tabId}
        aria-busy={loading}
      >
        {mode === "next" ? (
          <label className="intent-field">
            <span>Transition intent</span>
            <select value={intent} onChange={(event) => setIntent(event.currentTarget.value as DiscoveryIntent)}>
              {INTENTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        ) : null}

        {loading ? (
          <p className="discovery-request-status" role="status" aria-label="Discovery request status" aria-live="polite">
            {mode === "similar" ? "Finding similar tracks…" : "Ranking next tracks…"}
          </p>
        ) : null}

        {error !== null ? (
          <div className="discovery-error">
            <p role="alert">
              {error} {result === null ? "Try again." : "Showing the last successful results."}
            </p>
            <button type="button" className="filter-button" disabled={loading} onClick={() => setRequestNonce((current) => current + 1)}>
              {retryLabel}
            </button>
          </div>
        ) : null}

        {result !== null ? (
          <>
            <div className="discovery-result-summary">
              <p>{responseSummary(result)}</p>
              {result.truncated ? <p>Discovery scanned the first 25,000 matching tracks.</p> : null}
            </div>
            {result.items.length === 0 ? (
              <div className="discovery-empty" role="status">
                <strong>No candidates matched</strong>
                <span>Try another intent, loosen the filters, or choose a different seed.</span>
              </div>
            ) : (
              <ol className="discovery-candidates" aria-label={mode === "similar" ? "Similar candidates" : "Next-track candidates"}>
                {result.items.map((item, index) => <CandidateCard key={item.track.id} candidate={item} index={index} />)}
              </ol>
            )}
          </>
        ) : !loading && error === null ? (
          <div className="discovery-empty" role="status">
            <strong>Discovery is ready</strong>
            <span>Choose a mode to rank candidates from this seed.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
