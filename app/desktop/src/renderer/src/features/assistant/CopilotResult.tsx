import type {
  AssistantSearchResult,
  DiscoveryCandidate,
  ScoreComponent,
  TrackFilters,
  TrackListItem,
} from "../../../../shared/contracts";

export type CopilotCompletedResult =
  | { kind: "search"; result: AssistantSearchResult }
  | { kind: "explanation"; text: string; evidenceTrackIds: string[] }
  | { kind: "unsupported"; text: string };

interface KnownTrack {
  id: string;
  title: string | null;
  artist: string | null;
}

interface CopilotResultProps {
  value: CopilotCompletedResult;
  knownTracks: ReadonlyArray<KnownTrack>;
}

const FILTER_LABELS: Record<keyof TrackFilters, string> = {
  playlistId: "Playlist",
  text: "Text",
  bpmMinMilli: "Minimum BPM",
  bpmMaxMilli: "Maximum BPM",
  musicalKey: "Musical key",
  keyRelation: "Key relation",
  genre: "Genre",
  ratingMin: "Minimum rating",
  tag: "Exact tag",
  energyMinPpm: "Minimum energy",
  energyMaxPpm: "Maximum energy",
  analysisState: "Analysis state",
  availability: "Availability",
};

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

function formatPpm(value: number): string {
  return value.toLocaleString("en-US");
}

function formatSignedPpm(value: number): string {
  if (value > 0) return `+${formatPpm(value)}`;
  if (value < 0) return `−${formatPpm(Math.abs(value))}`;
  return "0";
}

function formatFilterValue(key: keyof TrackFilters, value: TrackFilters[keyof TrackFilters]): string {
  if (typeof value === "number") {
    if (key === "bpmMinMilli" || key === "bpmMaxMilli") return `${value / 1_000} BPM`;
    if (key === "energyMinPpm" || key === "energyMaxPpm") return `${formatPpm(value)} ppm`;
    if (key === "ratingMin") return `${value} ${value === 1 ? "star" : "stars"}`;
  }
  return String(value).replaceAll("_", " ");
}

function displayTitle(track: Pick<TrackListItem, "title">): string {
  return track.title ?? "Untitled track";
}

function TrackCard({ track }: { track: TrackListItem }) {
  const title = displayTitle(track);
  const rating = track.userMetadata.rating;
  const features = track.analysis?.features ?? null;
  return (
    <li className="copilot-track-card">
      <h4>{title}</h4>
      <p>{track.artist ?? "Unknown artist"}</p>
      <p className="copilot-track-card__evidence">
        {track.bpmMilli === null ? "BPM unavailable" : `${track.bpmMilli / 1_000} BPM`}
        <span aria-hidden="true"> · </span>
        {track.musicalKey ?? "Key unavailable"}
        <span aria-hidden="true"> · </span>
        {track.genre ?? "Genre unavailable"}
        <span aria-hidden="true"> · </span>
        {track.availability}
      </p>
      <p className="copilot-track-card__evidence">
        {track.album ?? "Album unavailable"}
        <span aria-hidden="true"> · </span>
        {rating === null ? "Unrated" : `${rating} ${rating === 1 ? "star" : "stars"}`}
      </p>
      {features === null ? (track.analysis === null ? null : (
        <p className="copilot-track-card__evidence">Local analysis {track.analysis.status.replaceAll("_", " ")}</p>
      )) : (
        <div className="copilot-track-card__analysis" aria-label={`Local analysis evidence for ${title}`}>
          <p>{features.bpmMilli === null ? "Local BPM unavailable" : `Local BPM ${features.bpmMilli / 1_000} · ${formatPpm(features.tempoConfidencePpm)} ppm confidence`}</p>
          <p>{`Local energy ${formatPpm(features.energyPpm)} ppm`}</p>
          <p>{features.musicalKey === null ? "Local key unavailable" : `Local key ${features.musicalKey} · ${formatPpm(features.keyConfidencePpm)} ppm confidence`}</p>
        </div>
      )}
    </li>
  );
}

function CandidateCard({ candidate }: { candidate: DiscoveryCandidate }) {
  const title = candidate.track.title ?? "Untitled track";
  return (
    <li className="copilot-track-card copilot-track-card--candidate">
      <div className="copilot-track-card__heading">
        <div>
          <h4>{title}</h4>
          <p>{candidate.track.artist ?? "Unknown artist"}</p>
        </div>
        <p className="copilot-track-card__score">
          <span>{formatPpm(candidate.scorePpm)} ppm score</span>
          <span>{formatPpm(candidate.confidencePpm)} ppm confidence</span>
        </p>
      </div>
      <p className="copilot-track-card__evidence">
        {candidate.track.bpmMilli === null ? "BPM unavailable" : `${candidate.track.bpmMilli / 1_000} BPM`}
        <span aria-hidden="true"> · </span>
        {candidate.track.musicalKey ?? "Key unavailable"}
        <span aria-hidden="true"> · </span>
        {candidate.track.genre ?? "Genre unavailable"}
      </p>
      <ul className="copilot-reasons" aria-label={`Local reasons for ${title}`}>
        {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      <ul className="copilot-score-components" aria-label={`Local score evidence for ${title}`}>
        {candidate.components.map((component) => (
          <li key={component.name}>
            <strong>{COMPONENT_LABELS[component.name]}</strong>
            <span>{component.reason}</span>
            <span>
              {`${component.scorePpm === null ? "No score" : `${formatPpm(component.scorePpm)} ppm score`} · ${formatPpm(component.weightPpm)} ppm weight · ${formatSignedPpm(component.contributionSignedPpm)} ppm contribution`}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function SearchResult({ result }: { result: AssistantSearchResult }) {
  if (result.mode === "unsupported") {
    return (
      <div className="copilot-empty" role="status">
        <strong>Copilot could not perform that search</strong>
        <span>{result.reason}</span>
      </div>
    );
  }

  if (result.mode === "filters") {
    const filters = (Object.entries(result.filters) as Array<[keyof TrackFilters, TrackFilters[keyof TrackFilters]]>)
      .filter((entry): entry is [keyof TrackFilters, Exclude<TrackFilters[keyof TrackFilters], undefined>] => entry[1] !== undefined);
    return (
      <>
        <h3>{result.summary}</h3>
        {filters.length === 0 ? <p className="copilot-result__meta">No structured filters were required.</p> : (
          <dl className="copilot-filter-ledger" aria-label="Interpreted local filters">
            {filters.map(([key, value]) => (
              <div key={key}>
                <dt>{FILTER_LABELS[key]}</dt>
                <dd>{formatFilterValue(key, value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {result.response.items.length === 0 ? (
          <div className="copilot-empty" role="status">
            <strong>No local tracks matched</strong>
            <span>Try a broader description or fewer constraints.</span>
          </div>
        ) : (
          <ul className="copilot-track-list" aria-label="Local tracks">
            {result.response.items.map((track) => <TrackCard key={track.id} track={track} />)}
          </ul>
        )}
        {result.response.truncated ? <p className="copilot-result__meta">The local result was truncated. Refine the request for a smaller set.</p> : null}
      </>
    );
  }

  const response = result.response;
  const label = result.mode === "similar" ? "Similar local candidates" : "Next-track local candidates";
  return (
    <>
      <h3>{result.summary}</h3>
      <p className="copilot-result__meta">
        {response.scannedCount.toLocaleString("en-US")} local tracks scanned
        <span aria-hidden="true"> · </span>
        Seed {response.seed.title ?? "Untitled track"}
        {result.mode === "next" ? <><span aria-hidden="true"> · </span>Intent {result.intent.replaceAll("_", " ")}</> : null}
      </p>
      {response.items.length === 0 ? (
        <div className="copilot-empty" role="status">
          <strong>No local candidates matched</strong>
          <span>Try a different seed, intent, or description.</span>
        </div>
      ) : (
        <ol className="copilot-track-list" aria-label={label}>
          {response.items.map((candidate) => <CandidateCard key={candidate.track.id} candidate={candidate} />)}
        </ol>
      )}
      {response.truncated ? <p className="copilot-result__meta">The local scan reached its bounded limit.</p> : null}
    </>
  );
}

function ExplanationText({ text, evidenceTrackIds, knownTracks }: {
  text: string;
  evidenceTrackIds: string[];
  knownTracks: ReadonlyArray<KnownTrack>;
}) {
  const evidence = new Set(evidenceTrackIds);
  const tracks = new Map(knownTracks.map((track) => [track.id, track]));
  const referencePattern = /\[track:([^\]\s]+)\]/gu;
  const fragments: Array<string | { id: string; start: number }> = [];
  let position = 0;
  for (const match of text.matchAll(referencePattern)) {
    const start = match.index;
    const id = match[1];
    if (start === undefined || id === undefined) continue;
    if (start > position) fragments.push(text.slice(position, start));
    const track = evidence.has(id) ? tracks.get(id) : undefined;
    if (track === undefined) fragments.push(match[0]);
    else fragments.push({ id, start });
    position = start + match[0].length;
  }
  if (position < text.length) fragments.push(text.slice(position));

  return (
    <p className="copilot-explanation">
      {fragments.map((fragment, index) => {
        if (typeof fragment === "string") return <span key={`text-${index}`}>{fragment}</span>;
        const track = tracks.get(fragment.id);
        if (track === undefined) return null;
        const title = track.title ?? "Untitled track";
        const artist = track.artist ?? "Unknown artist";
        return (
          <span
            key={`${fragment.id}-${fragment.start}`}
            className="copilot-citation"
            aria-label={`Track citation: ${title} by ${artist}`}
          >
            {title}
          </span>
        );
      })}
    </p>
  );
}

export function CopilotResult({ value, knownTracks }: CopilotResultProps) {
  return (
    <section className="copilot-result" aria-label="Copilot result">
      {value.kind === "search" ? <SearchResult result={value.result} /> : value.kind === "explanation" ? (
        <ExplanationText text={value.text} evidenceTrackIds={value.evidenceTrackIds} knownTracks={knownTracks} />
      ) : (
        <div className="copilot-empty" role="status">
          <strong>Copilot did not propose a change</strong>
          <span>{value.text}</span>
        </div>
      )}
    </section>
  );
}
