import type { CSSProperties } from "react";
import type { AnalysisFeatures } from "../../../../shared/contracts";

interface FeatureEvidenceProps {
  features: AnalysisFeatures;
  trackTitle: string;
}

function wholePercent(valuePpm: number): string {
  return `${Math.round(valuePpm / 10_000)}%`;
}

function formatBpm(valueMilli: number | null): string {
  if (valueMilli === null) return "Not enough evidence";
  const value = valueMilli / 1_000;
  return `${value.toFixed(valueMilli % 1_000 === 0 ? 0 : 1)} BPM`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = durationMs / 1_000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds - minutes * 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}

function formatMilliDb(valueMilli: number | null, unit: "dBFS" | "dB"): string {
  return valueMilli === null ? "Not enough evidence" : `${(valueMilli / 1_000).toFixed(1)} ${unit}`;
}

function formatKey(features: AnalysisFeatures): string {
  if (features.musicalKey === null) return "Not enough evidence";
  return features.mode === null ? features.musicalKey : `${features.musicalKey} ${features.mode}`;
}

function formatChannels(channels: number): string {
  return `${channels} ${channels === 1 ? "channel" : "channels"}`;
}

export function FeatureEvidence({ features, trackTitle }: FeatureEvidenceProps) {
  const energyProfile = features.energyCurvePpm.map(wholePercent);
  const rhythm = `${features.onsetCount.toLocaleString()} onsets · ${(features.onsetRateMilliHz / 1_000).toFixed(1)} Hz · beat strength ${wholePercent(features.beatStrengthPpm)}`;
  const timbre = features.spectralCentroidHz === null
    ? `Not enough evidence · brightness ${wholePercent(features.brightnessPpm)}`
    : `${features.spectralCentroidHz.toLocaleString()} Hz · brightness ${wholePercent(features.brightnessPpm)}`;

  return (
    <section className="feature-evidence" role="region" aria-label={`Local analysis for ${trackTitle}`}>
      <dl className="feature-ledger">
        <div><dt>Codec / container</dt><dd>{features.codec} / {features.container}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(features.durationMs)}</dd></div>
        <div><dt>Sample rate</dt><dd>{features.sampleRateHz.toLocaleString()} Hz</dd></div>
        <div><dt>Channels</dt><dd>{formatChannels(features.channels)}</dd></div>
        <div><dt>Local tempo</dt><dd>{formatBpm(features.bpmMilli)}</dd></div>
        <div><dt>Tempo confidence</dt><dd>Tempo confidence {wholePercent(features.tempoConfidencePpm)}</dd></div>
        <div><dt>Local key</dt><dd>{formatKey(features)}</dd></div>
        <div><dt>Key confidence</dt><dd>Key confidence {wholePercent(features.keyConfidencePpm)}</dd></div>
        <div><dt>RMS</dt><dd>{formatMilliDb(features.rmsMilliDbfs, "dBFS")}</dd></div>
        <div><dt>Peak</dt><dd>{formatMilliDb(features.peakMilliDbfs, "dBFS")}</dd></div>
        <div><dt>Crest factor</dt><dd>{formatMilliDb(features.crestFactorMilliDb, "dB")}</dd></div>
        <div><dt>Dynamic range</dt><dd>{formatMilliDb(features.dynamicRangeMilliDb, "dB")}</dd></div>
        <div><dt>Energy</dt><dd>Energy {wholePercent(features.energyPpm)}</dd></div>
        <div><dt>Rhythm</dt><dd>{rhythm}</dd></div>
        <div><dt>Timbre</dt><dd>{timbre}</dd></div>
        <div><dt>Provider</dt><dd>{features.provider}</dd></div>
        <div><dt>Pipeline</dt><dd>{features.pipelineVersion}</dd></div>
      </dl>

      <div className="energy-evidence">
        <p>Energy profile: {energyProfile.join(", ")}</p>
        <div className="energy-strip" aria-hidden="true">
          {features.energyCurvePpm.map((bucket, index) => (
            <span
              key={index}
              className="energy-strip__cell"
              style={{ "--energy-level": bucket / 10_000 } as CSSProperties}
            />
          ))}
        </div>
      </div>

      <div className="feature-provenance">
        <span>{features.providerVersion}</span>
      </div>
      <div className="feature-limitations">
        <p>Limitations</p>
        <ul>{features.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      </div>
    </section>
  );
}
