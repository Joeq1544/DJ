import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  CompareRecommendationsResponse,
  DesktopApi,
  DiscoveryCandidate,
  DiscoveryIntent,
  PreferenceProfile,
  ScoreComponent,
  SimilarityResponse,
  TrackFilters,
} from "../../../../shared/contracts";
import { preferenceStatusText } from "../personalization/PreferencePanel";

type DiscoveryMode = "similar" | "next";
type RecommendationFeedback = "accepted" | "rejected" | "skipped";
type RecommendationRankChange = CompareRecommendationsResponse["rankChanges"][number];

export interface DiscoverySeed {
  id: string;
  title: string;
  artist: string;
}

interface DiscoveryPanelProps {
  api: DesktopApi | null;
  seed: DiscoverySeed;
  filters: TrackFilters;
  preferenceResetNonce: number;
  onProfile: (profile: PreferenceProfile) => void;
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

function rankLabel(change: RecommendationRankChange): string {
  if (change.delta > 0) return `Baseline #${change.baselineRank} · up ${change.delta}`;
  if (change.delta < 0) return `Baseline #${change.baselineRank} · down ${Math.abs(change.delta)}`;
  return `Baseline #${change.baselineRank} · no rank change`;
}

interface CandidateCardProps {
  candidate: DiscoveryCandidate;
  index: number;
  rankChange: RecommendationRankChange | undefined;
  feedbackBusy: boolean;
  onFeedback: ((type: RecommendationFeedback, candidate: DiscoveryCandidate) => void) | undefined;
}

function CandidateCard({ candidate, index, rankChange, feedbackBusy, onFeedback }: CandidateCardProps) {
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
          {rankChange === undefined ? null : <span className="rank-change">{rankLabel(rankChange)}</span>}
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

      {onFeedback === undefined ? null : (
        <div className="candidate-feedback" aria-label={`Feedback for ${title}`}>
          <button type="button" className="personal-button" disabled={feedbackBusy} onClick={() => onFeedback("accepted", candidate)}>Accept {title}</button>
          <button type="button" className="personal-button" disabled={feedbackBusy} onClick={() => onFeedback("rejected", candidate)}>Reject {title}</button>
          <button type="button" className="personal-button" disabled={feedbackBusy} onClick={() => onFeedback("skipped", candidate)}>Skip {title}</button>
        </div>
      )}

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

function responseSummary(result: SimilarityResponse | CompareRecommendationsResponse): string {
  const response = "baseline" in result ? result.baseline : result;
  const count = response.items.length;
  return `${count} ${count === 1 ? "candidate" : "candidates"} · ${response.scannedCount.toLocaleString()} tracks scanned`;
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function DiscoveryPanel({ api, seed, filters, preferenceResetNonce, onProfile }: DiscoveryPanelProps) {
  const [mode, setMode] = useState<DiscoveryMode>("similar");
  const [intent, setIntent] = useState<DiscoveryIntent>("smooth");
  const [similarResult, setSimilarResult] = useState<SimilarityResponse | null>(null);
  const [comparisonResult, setComparisonResult] = useState<CompareRecommendationsResponse | null>(null);
  const [comparisonResetNonce, setComparisonResetNonce] = useState(preferenceResetNonce);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState<string | null>(null);
  const [requestNonce, setRequestNonce] = useState(0);
  const requestSequence = useRef(0);
  const feedbackSequence = useRef(0);
  const mounted = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const similarTabRef = useRef<HTMLButtonElement>(null);
  const nextTabRef = useRef<HTMLButtonElement>(null);
  const nextComparisonNonce = mode === "next" ? preferenceResetNonce : 0;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      feedbackSequence.current += 1;
    };
  }, []);

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
      return () => { active = false; };
    }

    const requestFilters = Object.keys(filters).length === 0 ? undefined : filters;
    const request = mode === "similar"
      ? api.discovery.findSimilar({
          seedTrackId: seed.id,
          ...(requestFilters === undefined ? {} : { filters: requestFilters }),
          limit: 10,
        })
      : api.preferences.compareRecommendations({
          seedTrackId: seed.id,
          intent,
          ...(requestFilters === undefined ? {} : { filters: requestFilters }),
          limit: 10,
        });

    void request
      .then((result) => {
        if (!active || sequence !== requestSequence.current) return;
        if (mode === "similar") {
          setSimilarResult(result as SimilarityResponse);
        } else {
          const comparison = result as CompareRecommendationsResponse;
          setComparisonResult(comparison);
          setComparisonResetNonce(preferenceResetNonce);
          onProfile(comparison.profile);
        }
      })
      .catch((requestError: unknown) => {
        if (!active || sequence !== requestSequence.current) return;
        setError(mode === "similar"
          ? "Similar tracks could not be loaded."
          : readableError(requestError, "Next-track recommendations could not be loaded."));
      })
      .finally(() => {
        if (!active || sequence !== requestSequence.current) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api, filters, intent, mode, nextComparisonNonce, onProfile, requestNonce, seed.id]);

  const visibleComparisonResult = comparisonResetNonce === preferenceResetNonce ? comparisonResult : null;
  const result = mode === "similar" ? similarResult : visibleComparisonResult;
  const tabId = mode === "similar" ? "discovery-tab-similar" : "discovery-tab-next";

  const chooseMode = (nextMode: DiscoveryMode, moveFocus = false) => {
    setMode(nextMode);
    setError(null);
    setFeedbackError(null);
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

  const recordFeedback = async (type: RecommendationFeedback, candidate: DiscoveryCandidate) => {
    if (api === null || feedbackBusy !== null) return;
    const sequence = ++feedbackSequence.current;
    setFeedbackBusy(`${type}:${candidate.track.id}`);
    setFeedbackError(null);
    setFeedbackMessage(null);
    try {
      const response = await api.preferences.recordFeedback({
        type,
        trackId: candidate.track.id,
        seedTrackId: seed.id,
        intent,
      });
      if (!mounted.current || sequence !== feedbackSequence.current) return;
      onProfile(response.profile);
      setFeedbackMessage(`${type === "accepted" ? "Accepted" : type === "rejected" ? "Rejected" : "Skipped"} ${displayTitle(candidate)}.`);
      setRequestNonce((current) => current + 1);
    } catch (recordError) {
      if (!mounted.current || sequence !== feedbackSequence.current) return;
      setFeedbackError(readableError(recordError, "Feedback could not be recorded."));
    } finally {
      if (mounted.current && sequence === feedbackSequence.current) setFeedbackBusy(null);
    }
  };

  const retryLabel = mode === "similar" ? "Retry similar tracks" : "Retry next-track recommendations";
  const response = result === null ? null : "baseline" in result
    ? (result.profile.status === "active" ? result.personalized : result.baseline)
    : result;
  const rankChanges = visibleComparisonResult === null
    ? new Map<string, RecommendationRankChange>()
    : new Map(visibleComparisonResult.rankChanges.map((change) => [change.trackId, change]));

  return (
    <section className="discovery-panel" aria-labelledby="discovery-heading">
      <header className="discovery-panel__header">
        <div>
          <p className="eyebrow">Current seed</p>
          <h2 id="discovery-heading" ref={headingRef} tabIndex={-1}>Explore {seed.title}</h2>
          <p className="discovery-panel__seed">{seed.artist}</p>
        </div>
        <div className="discovery-tabs" role="tablist" aria-label="Discovery mode">
          <button id="discovery-tab-similar" ref={similarTabRef} type="button" role="tab" aria-selected={mode === "similar"} aria-controls="discovery-results" tabIndex={mode === "similar" ? 0 : -1} onClick={() => chooseMode("similar")} onKeyDown={onTabKeyDown}>Similar</button>
          <button id="discovery-tab-next" ref={nextTabRef} type="button" role="tab" aria-selected={mode === "next"} aria-controls="discovery-results" tabIndex={mode === "next" ? 0 : -1} onClick={() => chooseMode("next")} onKeyDown={onTabKeyDown}>Next</button>
        </div>
      </header>

      <div id="discovery-results" className="discovery-panel__body" role="tabpanel" aria-labelledby={tabId} aria-busy={loading}>
        {mode === "next" ? (
          <label className="intent-field">
            <span>Transition intent</span>
            <select value={intent} onChange={(event) => setIntent(event.currentTarget.value as DiscoveryIntent)}>
              {INTENTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        ) : null}

        {mode === "next" && visibleComparisonResult !== null ? (
          <p className={`comparison-status comparison-status--${visibleComparisonResult.profile.status}`} role="status" aria-live="polite">
            {preferenceStatusText(visibleComparisonResult.profile)}
          </p>
        ) : null}

        {loading ? <p className="discovery-request-status" role="status" aria-label="Discovery request status" aria-live="polite">{mode === "similar" ? "Finding similar tracks…" : "Comparing baseline and personal ranking…"}</p> : null}

        {error !== null ? (
          <div className="discovery-error">
            <p role="alert">{error} {result === null ? "Try again." : "Showing the last successful results."}</p>
            <button type="button" className="filter-button" disabled={loading} onClick={() => setRequestNonce((current) => current + 1)}>{retryLabel}</button>
          </div>
        ) : null}
        {feedbackError === null ? null : <p className="personal-status personal-status--error" role="alert">{feedbackError}</p>}
        {feedbackMessage === null ? null : <p className="personal-status personal-status--success" role="status" aria-live="polite">{feedbackMessage}</p>}

        {result !== null && response !== null ? (
          <>
            <div className="discovery-result-summary">
              <p>{responseSummary(result)}</p>
              {response.truncated ? <p>Discovery scanned the first 25,000 matching tracks.</p> : null}
            </div>
            {response.items.length === 0 ? (
              <div className="discovery-empty" role="status"><strong>No candidates matched</strong><span>Try another intent, loosen the filters, or choose a different seed.</span></div>
            ) : (
              <ol className="discovery-candidates" aria-label={mode === "similar" ? "Similar candidates" : "Next-track candidates"}>
                {response.items.map((item, index) => (
                  <CandidateCard
                    key={item.track.id}
                    candidate={item}
                    index={index}
                    rankChange={mode === "next" ? rankChanges.get(item.track.id) : undefined}
                    feedbackBusy={feedbackBusy !== null || loading}
                    onFeedback={mode === "next" ? (type, candidateItem) => { void recordFeedback(type, candidateItem); } : undefined}
                  />
                ))}
              </ol>
            )}
          </>
        ) : !loading && error === null ? (
          <div className="discovery-empty" role="status"><strong>Discovery is ready</strong><span>Choose a mode to rank candidates from this seed.</span></div>
        ) : null}
      </div>
    </section>
  );
}
