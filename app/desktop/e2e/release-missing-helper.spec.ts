import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";
import type { DesktopApi } from "../src/shared/contracts";

const execFileAsync = promisify(execFile);
const desktopDirectory = process.cwd();
const repositoryRoot = resolve(desktopDirectory, "../..");
const packagedApplication = join(
  repositoryRoot,
  "out",
  "DJ Copilot-darwin-arm64",
  "DJ Copilot.app",
);
const packagedFfprobe = join(
  packagedApplication,
  "Contents",
  "Resources",
  "bin",
  "ffprobe",
);

declare global {
  interface Window {
    djCopilot: DesktopApi;
  }
}

async function packagedApplicationExists(): Promise<boolean> {
  try {
    await access(packagedApplication);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function cloneApplication(destination: string): Promise<void> {
  try {
    await execFileAsync(
      "/bin/cp",
      ["-cR", packagedApplication, destination],
      { env: { PATH: "/usr/bin:/bin" }, maxBuffer: 16 * 1024 },
    );
  } catch (error) {
    throw new Error(
      "APFS clone copy failed; refusing to weaken the missing-helper gate or touch the release artifact.",
      { cause: error },
    );
  }
  expect((await stat(destination)).isDirectory()).toBe(true);
}

function packagedEnvironment(ambientFfprobe: string): Record<string, string> {
  const source = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const {
    VITE_DEV_SERVER_URL: _devRenderer,
    DJ_COPILOT_PYTHON: _python,
    DJ_COPILOT_FFMPEG: _ffmpeg,
    DJ_COPILOT_FFPROBE: _ffprobe,
    DJ_COPILOT_TEST_XML: _testXml,
    DJ_COPILOT_ASSISTANT_PROVIDER: _assistantProvider,
    PYTHONPATH: _pythonPath,
    NODE_PATH: _nodePath,
    ELECTRON_RUN_AS_NODE: _electronRunAsNode,
    ...environment
  } = source;
  return {
    ...environment,
    PATH: "/usr/bin:/bin",
    DJ_COPILOT_TEST_MODE: "1",
    DJ_COPILOT_ASSISTANT_PROVIDER: "mock",
    // If packaged mode honored this valid external override, the negative gate
    // would incorrectly report analysis as available.
    DJ_COPILOT_FFPROBE: ambientFfprobe,
  };
}

async function waitForCore(application: ElectronApplication): Promise<void> {
  await expect.poll(() => application.evaluate(() => {
    const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as {
      getStatus(): { state: string };
    } | undefined;
    if (hook === undefined) throw new Error("Packaged core test hook is unavailable");
    return hook.getStatus().state;
  }), { timeout: 30_000, intervals: [100, 250, 500] }).toBe("ready");
}

async function runtimeDirectory(application: ElectronApplication): Promise<string> {
  return application.evaluate(() => {
    const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as {
      getRuntimeDirectory(): string;
    } | undefined;
    if (hook === undefined) throw new Error("Packaged runtime test hook is unavailable");
    return hook.getRuntimeDirectory();
  });
}

test("packaged mode stays usable and fails closed when bundled ffprobe is missing", async () => {
  test.setTimeout(120_000);
  test.skip(
    !(await packagedApplicationExists()),
    "The packaged DJ Copilot.app has not been built yet.",
  );

  expect((await stat(packagedApplication)).isDirectory()).toBe(true);
  await expect(access(packagedFfprobe, constants.X_OK)).resolves.toBeUndefined();
  const releaseFfprobeHash = await sha256(packagedFfprobe);

  const temporaryRoot = await mkdtemp(join(tmpdir(), "DJ Copilot Missing Helper Gate "));
  const copiedApplication = join(temporaryRoot, "DJ Copilot Missing FFprobe.app");
  const copiedExecutable = join(copiedApplication, "Contents", "MacOS", "DJ Copilot");
  const copiedResources = join(copiedApplication, "Contents", "Resources");
  const copiedFfprobe = join(copiedResources, "bin", "ffprobe");
  const userDataPath = join(temporaryRoot, "User Data With Spaces");
  let application: ElectronApplication | undefined;
  let coreRuntimeDirectory: string | undefined;

  expect(copiedApplication).toContain(" ");
  expect(userDataPath).toContain(" ");

  try {
    await cloneApplication(copiedApplication);
    await expect(access(copiedExecutable, constants.X_OK)).resolves.toBeUndefined();
    expect(await sha256(copiedFfprobe)).toBe(releaseFfprobeHash);

    // This is the only deliberate mutation. The release artifact remains intact.
    await unlink(copiedFfprobe);
    await expect(access(copiedFfprobe)).rejects.toThrow();
    await expect(access(packagedFfprobe, constants.X_OK)).resolves.toBeUndefined();

    application = await electron.launch({
      executablePath: copiedExecutable,
      args: [`--user-data-dir=${userDataPath}`],
      env: packagedEnvironment(packagedFfprobe),
    });
    const page = await application.firstWindow();
    await waitForCore(application);

    const mainLayout = await application.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    }));
    expect(mainLayout).toEqual({
      isPackaged: true,
      resourcesPath: await realpath(copiedResources),
    });

    const evidence = await page.evaluate(async () => ({
      system: await window.djCopilot.system.getStatus(),
      playlists: await window.djCopilot.library.getPlaylistTree(),
      tracks: await window.djCopilot.library.listTracks({ limit: 10 }),
      analysis: await window.djCopilot.analysis.getStatus(),
      diagnostics: await window.djCopilot.diagnostics.getSnapshot(),
    }));

    expect(evidence.system).toEqual({ state: "ready", message: null });
    expect(evidence.playlists).toEqual([]);
    expect(evidence.tracks).toMatchObject({ items: [] });
    expect(evidence.analysis).toMatchObject({
      state: "idle",
      capabilities: {
        available: false,
        provider: "ffmpeg-numpy-basic",
        providerVersion: null,
        pipelineVersion: "baseline-v1",
      },
    });
    expect(evidence.analysis.capabilities.unavailableReason).toMatch(/ffprobe|prerequisite/i);
    expect(evidence.diagnostics).toMatchObject({
      releaseMode: "personal_arm64",
      databaseIntegrity: "ok",
      analysis: {
        available: false,
        providerVersion: null,
      },
      resources: {
        core: { status: "available", version: "0.1.0", source: "bundled" },
        ffmpeg: { status: "available", version: "8.1.2", source: "bundled" },
        ffprobe: {
          status: "unavailable",
          version: null,
          source: "bundled",
          message: "Bundled FFprobe 8.1.2 is unavailable.",
        },
      },
    });
    expect(evidence.diagnostics.analysis).toEqual(evidence.analysis.capabilities);

    // The original executable was explicitly offered through the inherited
    // override while PATH remained minimal. Unavailability proves no fallback.
    await expect(access(packagedFfprobe, constants.X_OK)).resolves.toBeUndefined();
    expect(await sha256(packagedFfprobe)).toBe(releaseFfprobeHash);

    coreRuntimeDirectory = await runtimeDirectory(application);
    await application.close();
    application = undefined;
    await expect(access(coreRuntimeDirectory)).rejects.toThrow();

    console.log(`M7_MISSING_HELPER_EVIDENCE ${JSON.stringify({
      copiedApplication: true,
      cloneCopy: true,
      minimalPath: "/usr/bin:/bin",
      userDataPathWithSpaces: true,
      coreReady: true,
      ffprobeUnavailable: true,
      analysisUnavailable: true,
      ambientOverrideIgnored: true,
      runtimeDirectoryCleaned: true,
      releaseArtifactPreserved: true,
    })}`);
  } finally {
    await application?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
    await expect(access(temporaryRoot)).rejects.toThrow();
    await expect(access(packagedFfprobe, constants.X_OK)).resolves.toBeUndefined();
    expect(await sha256(packagedFfprobe)).toBe(releaseFfprobeHash);
  }
});
