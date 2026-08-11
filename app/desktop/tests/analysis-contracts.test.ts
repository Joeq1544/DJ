import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { CoreSupervisor } from "../src/main/core-supervisor";
import {
  analysisFeaturesSchema,
  analysisQueueStatusSchema,
  coreRequestSchema,
  trackPageSchema,
} from "../src/shared/contracts";

const features = {
  fingerprint: "a".repeat(64),
  fileSize: 1_024,
  mtimeNs: 1_725_000_000_000_000_000,
  codec: "pcm_s16le",
  container: "wav",
  durationMs: 16_000,
  sampleRateHz: 48_000,
  channels: 1,
  bpmMilli: null,
  tempoConfidencePpm: 0,
  tempoCandidatesMilli: [],
  onsetCount: 0,
  beatStrengthPpm: 0,
  musicalKey: null,
  mode: null,
  keyConfidencePpm: 0,
  rmsMilliDbfs: null,
  peakMilliDbfs: null,
  crestFactorMilliDb: null,
  energyPpm: 0,
  dynamicRangeMilliDb: null,
  onsetRateMilliHz: 0,
  spectralCentroidHz: null,
  brightnessPpm: 0,
  energyCurvePpm: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  provider: "ffmpeg-numpy-basic",
  providerVersion: "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
  pipelineVersion: "baseline-v1",
  limitations: ["Generated test evidence only."],
};

const status = {
  state: "idle",
  queued: 0,
  running: 0,
  paused: 0,
  succeeded: 1,
  failed: 0,
  progressPpm: 1_000_000,
  capabilities: {
    available: true,
    provider: "ffmpeg-numpy-basic",
    providerVersion: "ffmpeg 8.1.2; ffprobe 8.1.2; numpy 2.4.4",
    pipelineVersion: "baseline-v1",
    availableStages: ["metadata", "basic_features"],
    unavailableStages: ["structure", "embeddings"],
    unavailableReason: null,
  },
  items: [
    {
      trackId: "track-1",
      status: "succeeded",
      progressPpm: 1_000_000,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      features,
    },
  ],
};

describe("analysis boundary contracts", () => {
  it("accepts the complete exact local provider DTO including nullable low-confidence fields", () => {
    expect(analysisFeaturesSchema.parse(features)).toEqual(features);
    expect(analysisQueueStatusSchema.parse(status)).toEqual(status);
  });

  it("rejects out-of-range scaled values and incorrect provenance", () => {
    expect(analysisFeaturesSchema.safeParse({ ...features, tempoConfidencePpm: 1_000_001 }).success).toBe(false);
    expect(analysisFeaturesSchema.safeParse({ ...features, energyPpm: -1 }).success).toBe(false);
    expect(analysisQueueStatusSchema.safeParse({ ...status, progressPpm: 1_000_001 }).success).toBe(false);
    expect(analysisFeaturesSchema.safeParse({ ...features, provider: "other-provider" }).success).toBe(false);
    expect(analysisFeaturesSchema.safeParse({ ...features, providerVersion: "ffmpeg latest" }).success).toBe(false);
    expect(analysisFeaturesSchema.safeParse({ ...features, pipelineVersion: "latest" }).success).toBe(false);
  });

  it("rejects private paths and unknown fields in analysis and track DTOs", () => {
    expect(analysisFeaturesSchema.safeParse({ ...features, sourcePath: "/private/music/track.wav" }).success).toBe(false);
    expect(analysisQueueStatusSchema.safeParse({ ...status, socketPath: "/private/core.sock" }).success).toBe(false);
    expect(
      trackPageSchema.safeParse({
        items: [
          {
            id: "track-1",
            title: "Generated",
            artist: "Fixture",
            album: null,
            genre: null,
            bpmMilli: null,
            musicalKey: null,
            durationMs: 16_000,
            availability: "available",
            analysis: {
              status: "succeeded",
              progressPpm: 1_000_000,
              attemptCount: 1,
              errorCode: null,
              errorMessage: null,
              features: { ...features, normalizedPath: "/private/music/track.wav" },
            },
          },
        ],
        nextCursor: null,
        truncated: false,
      }).success,
    ).toBe(false);
  });

  it("accepts at most two hundred unique analysis IDs in strict request variants", () => {
    const twoHundred = Array.from({ length: 200 }, (_, index) => `track-${index}`);
    expect(
      coreRequestSchema.safeParse({
        version: 1,
        id: "queue-200",
        command: "queue_analysis",
        payload: { trackIds: twoHundred },
      }).success,
    ).toBe(true);
    expect(
      coreRequestSchema.safeParse({
        version: 1,
        id: "queue-201",
        command: "queue_analysis",
        payload: { trackIds: [...twoHundred, "track-200"] },
      }).success,
    ).toBe(false);
    expect(
      coreRequestSchema.safeParse({
        version: 1,
        id: "status-all",
        command: "get_analysis_status",
        payload: {},
      }).success,
    ).toBe(true);
  });
});

class FakeChild extends EventEmitter {
  readonly stderr = new EventEmitter();
  exitCode: number | null = null;

  kill(): boolean {
    this.exitCode = 0;
    queueMicrotask(() => this.emit("exit", 0, null));
    return true;
  }
}

describe("development Python selection", () => {
  it("prefers the environment, then an executable repository venv, then python3", async () => {
    const cases = [
      {
        environment: { DJ_COPILOT_PYTHON: "/configured/python" },
        executable: true,
        expected: "/configured/python",
        checks: [] as string[],
      },
      {
        environment: {},
        executable: true,
        expected: "/repo/.venv/bin/python",
        checks: [] as string[],
      },
      {
        environment: {},
        executable: false,
        expected: "python3",
        checks: [] as string[],
      },
    ];
    for (const scenario of cases) {
      let spawnedCommand = "";
      const supervisor = new CoreSupervisor({
        userDataPath: "/user-data",
        repositoryRoot: "/repo",
        environment: scenario.environment,
        isExecutable: async (candidate) => {
          scenario.checks.push(candidate);
          return scenario.executable;
        },
        spawn: (command) => {
          spawnedCommand = command;
          return new FakeChild() as never;
        },
        createClient: () => ({ request: async () => ({ state: "ready" }), close() {} }),
      });

      await supervisor.start();
      expect(spawnedCommand).toBe(scenario.expected);
      expect(scenario.checks).toEqual(
        scenario.environment.DJ_COPILOT_PYTHON ? [] : ["/repo/.venv/bin/python"],
      );
      await supervisor.stop();
    }
  });
});
