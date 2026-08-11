import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  open,
  readFile,
  realpath as nodeRealpath,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  coreDiagnosticsSchema,
  diagnosticsSnapshotSchema,
  type CoreDiagnostics,
  type DiagnosticsSnapshot,
} from "../shared/contracts";

const CODEX_VERSION = "0.147.0";
const FFMPEG_VERSION = "8.1.2";
const PRIVACY_STATEMENT = "No audio, library metadata, notes, credentials, paths, logs, or Codex response text included.";

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
}

export interface DiagnosticsBoundaryOptions {
  releaseMode: "development" | "personal_arm64";
  resourcesPath?: string;
  repositoryRoot: string;
  appVersion: string;
  electronVersion: string;
  architecture: string;
  now?: () => Date;
  isExecutable?: (path: string) => Promise<boolean>;
  probeVersion?: (path: string) => Promise<string>;
  realpath?: (path: string) => Promise<string>;
  readPackageMetadata?: (path: string) => Promise<PackageMetadata>;
}

export interface DiagnosticsBoundary {
  getSnapshot(core: CoreDiagnostics): Promise<DiagnosticsSnapshot>;
}

export interface DiagnosticsWriteOptions {
  temporaryId?: () => string;
  renameFile?: (source: string, destination: string) => Promise<void>;
}

async function defaultIsExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function defaultProbeVersion(path: string): Promise<string> {
  return new Promise<string>((resolveVersion, reject) => {
    execFile(
      path,
      ["-version"],
      {
        env: { PATH: "/usr/bin:/bin" },
        timeout: 3_000,
        maxBuffer: 8_192,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolveVersion(`${stdout}${stderr}`.split(/\r?\n/u)[0]?.trim() ?? "");
      },
    );
  });
}

async function defaultReadPackageMetadata(path: string): Promise<PackageMetadata> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid package metadata");
  }
  return parsed as PackageMetadata;
}

function available(version: string, source: "bundled" | "development") {
  return { status: "available" as const, version, source, message: null };
}

function unavailable(message: string, source: "bundled" | "development") {
  return { status: "unavailable" as const, version: null, source, message };
}

function exactDecoderVersion(output: string, binary: "ffmpeg" | "ffprobe"): boolean {
  const escapedVersion = FFMPEG_VERSION.replaceAll(".", "\\.");
  return new RegExp(`^${binary} version ${escapedVersion}(?:\\s|$)`, "u").test(output);
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function developmentDecoderState(
  core: CoreDiagnostics,
  binary: "ffmpeg" | "ffprobe",
) {
  const source = "development" as const;
  const providerVersion = core.analysis.providerVersion;
  const exactToken = `${binary} ${FFMPEG_VERSION}`;
  if (
    core.analysis.available
    && providerVersion !== null
    && providerVersion.split("; ").includes(exactToken)
  ) {
    return available(FFMPEG_VERSION, source);
  }
  return unavailable(
    binary === "ffmpeg"
      ? "Development FFmpeg 8.1.2 is unavailable."
      : "Development FFprobe 8.1.2 is unavailable.",
    source,
  );
}

export function createDiagnosticsBoundary(options: DiagnosticsBoundaryOptions): DiagnosticsBoundary {
  const now = options.now ?? (() => new Date());
  const isExecutable = options.isExecutable ?? defaultIsExecutable;
  const probeVersion = options.probeVersion ?? defaultProbeVersion;
  const canonicalize = options.realpath ?? nodeRealpath;
  const readPackageMetadata = options.readPackageMetadata ?? defaultReadPackageMetadata;

  if (options.releaseMode === "personal_arm64" && options.resourcesPath === undefined) {
    throw new Error("Packaged resources path is required");
  }

  return {
    async getSnapshot(value) {
      const core = coreDiagnosticsSchema.parse(value);
      const source = options.releaseMode === "personal_arm64" ? "bundled" : "development";
      let coreResource: DiagnosticsSnapshot["resources"]["core"] = available(core.coreVersion, source);
      let ffmpegResource: DiagnosticsSnapshot["resources"]["ffmpeg"];
      let ffprobeResource: DiagnosticsSnapshot["resources"]["ffprobe"];
      let codexResource: DiagnosticsSnapshot["resources"]["codex"];

      if (options.releaseMode === "personal_arm64") {
        const resourcesPath = options.resourcesPath!;
        const corePath = join(resourcesPath, "core", "dj-copilot-core", "dj-copilot-core");
        const ffmpegPath = join(resourcesPath, "bin", "ffmpeg");
        const ffprobePath = join(resourcesPath, "bin", "ffprobe");
        const [corePresent, ffmpegPresent, ffprobePresent] = await Promise.all([
          isExecutable(corePath),
          isExecutable(ffmpegPath),
          isExecutable(ffprobePath),
        ]);
        if (!corePresent) {
          coreResource = unavailable("Bundled core 0.1.0 is unavailable.", source);
        }
        const [ffmpegOutput, ffprobeOutput] = await Promise.all([
          ffmpegPresent ? probeVersion(ffmpegPath).catch(() => "") : Promise.resolve(""),
          ffprobePresent ? probeVersion(ffprobePath).catch(() => "") : Promise.resolve(""),
        ]);
        ffmpegResource = ffmpegPresent && exactDecoderVersion(ffmpegOutput, "ffmpeg")
          ? available(FFMPEG_VERSION, source)
          : unavailable("Bundled FFmpeg 8.1.2 is unavailable.", source);
        ffprobeResource = ffprobePresent && exactDecoderVersion(ffprobeOutput, "ffprobe")
          ? available(FFMPEG_VERSION, source)
          : unavailable("Bundled FFprobe 8.1.2 is unavailable.", source);
      } else {
        ffmpegResource = developmentDecoderState(core, "ffmpeg");
        ffprobeResource = developmentDecoderState(core, "ffprobe");
      }

      const packageRoot = options.releaseMode === "personal_arm64"
        ? join(options.resourcesPath!, "app", "node_modules", "@openai")
        : join(options.repositoryRoot, "app", "desktop", "node_modules", "@openai");
      try {
        const sdkRoot = await canonicalize(join(packageRoot, "codex-sdk"));
        const helperRoot = await canonicalize(join(dirname(sdkRoot), "codex"));
        if (options.releaseMode === "personal_arm64") {
          const applicationRoot = join(options.resourcesPath!, "app");
          if (!isInside(applicationRoot, sdkRoot) || !isInside(applicationRoot, helperRoot)) {
            throw new Error("Packaged Codex resolved outside the application");
          }
        }
        const [sdk, helper] = await Promise.all([
          readPackageMetadata(join(sdkRoot, "package.json")),
          readPackageMetadata(join(helperRoot, "package.json")),
        ]);
        codexResource = sdk.name === "@openai/codex-sdk"
          && sdk.version === CODEX_VERSION
          && helper.name === "@openai/codex"
          && helper.version === CODEX_VERSION
          ? available(CODEX_VERSION, source)
          : unavailable(
            options.releaseMode === "personal_arm64"
              ? "Bundled Codex 0.147.0 is unavailable."
              : "Development Codex 0.147.0 is unavailable.",
            source,
          );
      } catch {
        codexResource = unavailable(
          options.releaseMode === "personal_arm64"
            ? "Bundled Codex 0.147.0 is unavailable."
            : "Development Codex 0.147.0 is unavailable.",
          source,
        );
      }

      return diagnosticsSnapshotSchema.parse({
        appVersion: options.appVersion,
        electronVersion: options.electronVersion,
        architecture: options.architecture,
        releaseMode: options.releaseMode,
        schemaVersion: core.schemaVersion,
        databaseIntegrity: core.databaseIntegrity,
        analysis: core.analysis,
        resources: {
          core: coreResource,
          ffmpeg: ffmpegResource,
          ffprobe: ffprobeResource,
          codex: codexResource,
        },
        generatedAt: now().toISOString(),
        privacy: PRIVACY_STATEMENT,
      });
    },
  };
}

export async function writeDiagnosticsSnapshot(
  destinationPath: string,
  value: DiagnosticsSnapshot,
  options: DiagnosticsWriteOptions = {},
): Promise<{ sizeBytes: number; createdAt: string }> {
  if (!isAbsolute(destinationPath) || resolve(destinationPath) !== destinationPath) {
    throw new Error("Diagnostics destination must be absolute");
  }
  const snapshot = diagnosticsSnapshotSchema.parse(value);
  const id = (options.temporaryId ?? randomUUID)();
  if (!/^[A-Za-z0-9-]{1,128}$/u.test(id)) throw new Error("Invalid temporary identifier");
  const temporaryPath = join(dirname(destinationPath), `.${basename(destinationPath)}.${id}.tmp`);
  const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  const renameFile = options.renameFile ?? rename;
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameFile(temporaryPath, destinationPath);
    return { sizeBytes: bytes.byteLength, createdAt: snapshot.generatedAt };
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}
