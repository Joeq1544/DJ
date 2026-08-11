import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildDesktop } from "./build-desktop";

const desktopDirectory = process.cwd();
const repositoryRoot = resolve(desktopDirectory, "../..");
const fixturePath = join(repositoryRoot, "fixtures/rekordbox/phase0-library.xml");
const mainEntry = join(desktopDirectory, "dist/main/main.cjs");
const execFileAsync = promisify(execFile);

async function compatiblePython(): Promise<string> {
  const candidates = [...new Set((process.env.PATH ?? "").split(delimiter).filter(Boolean))]
    .map((directory) => join(directory, "python3"));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      const { stdout } = await execFileAsync(candidate, ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"]);
      const [major, minor] = stdout.trim().split(".").map(Number);
      if ((major ?? 0) > 3 || (major === 3 && (minor ?? 0) >= 12)) return candidate;
    } catch {
      // Continue until a Python compatible with the core's supported syntax is found.
    }
  }
  throw new Error("A CPython 3.12+ executable is required for the Electron fixture flow");
}

function electronTestEnvironment(pythonExecutable: string, testXml?: string): Record<string, string> {
  const definedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const { VITE_DEV_SERVER_URL: _ignoredDevRendererUrl, ...environment } = definedEnvironment;
  return {
    ...environment,
    DJ_COPILOT_TEST_MODE: "1",
    DJ_COPILOT_PYTHON: pythonExecutable,
    ...(testXml ? { DJ_COPILOT_TEST_XML: testXml } : {}),
  };
}

test.beforeAll(async () => {
  await buildDesktop(desktopDirectory);
});

test("imports the fixture and recovers the browsable library after one core restart", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "dj-copilot-e2e-"));
  const pythonExecutable = await compatiblePython();
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataPath}`],
      env: electronTestEnvironment(pythonExecutable, fixturePath),
    });
    const page = await application.firstWindow();
    expect(new URL(page.url()).protocol).toBe("file:");

    await expect.poll(() => application!.evaluate(() => {
      const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getStatus(): { state: string } };
      return hook.getStatus().state;
    })).toBe("ready");
    await expect(page.getByRole("button", { name: "Import Rekordbox XML" })).toBeVisible();
    await page.getByRole("button", { name: "Import Rekordbox XML" }).click();
    await expect(page.getByText("4 tracks imported and 4 playlists.")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(4);
    const recoveryState = await application.evaluate(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, "__DJ_COPILOT_TEST_HOOK__");
      if (!descriptor || descriptor.enumerable || typeof descriptor.value?.forceCoreExit !== "function") {
        throw new Error("Test-only core recovery hook is unavailable");
      }
      return descriptor.value.forceCoreExit();
    });
    expect(recoveryState).toBe("retrying");
    await expect.poll(() => application!.evaluate(() => {
      const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getStatus(): { state: string } };
      return hook.getStatus().state;
    })).toBe("ready");

    await page.reload();
    await expect(page.locator("tbody tr")).toHaveCount(4);
    await page.getByRole("treeitem", { name: /Opening/ }).click();
    const openingRows = page.locator("tbody tr");
    await expect(openingRows).toHaveCount(2);
    await expect(openingRows.nth(0)).toContainText("Same Title");
    await expect(openingRows.nth(1)).toContainText("Same Title");
    const runtimeDirectory = await application.evaluate(() => {
      const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getRuntimeDirectory(): string | undefined };
      return hook.getRuntimeDirectory();
    });
    expect(runtimeDirectory).toBeTruthy();
    await application.close();
    application = undefined;
    await expect(access(runtimeDirectory!)).rejects.toThrow();
  } finally {
    await application?.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("uses stubbed Electron dialog cancellation and selection without a fixture override", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "dj-copilot-e2e-"));
  const pythonExecutable = await compatiblePython();
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataPath}`],
      env: electronTestEnvironment(pythonExecutable),
    });
    const page = await application.firstWindow();
    await expect.poll(() => application!.evaluate(() => {
      const hook = Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getStatus(): { state: string } };
      return hook.getStatus().state;
    })).toBe("ready");
    const stubbed = await application.evaluate(({ dialog }) => {
      const dialogStub = dialog as unknown as { showOpenDialog: (window: unknown, options: unknown) => Promise<unknown> };
      if (typeof dialogStub.showOpenDialog !== "function") return false;
      Object.defineProperty(globalThis, "__DJ_COPILOT_ORIGINAL_DIALOG__", {
        configurable: true,
        value: dialogStub.showOpenDialog,
      });
      dialogStub.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      return true;
    });
    expect(stubbed).toBe(true);
    await page.getByRole("button", { name: "Import Rekordbox XML" }).click();
    await expect(page.getByText("No tracks imported yet")).toBeVisible();

    await application.evaluate(({ dialog }, selectedPath: string) => {
      const dialogStub = dialog as unknown as { showOpenDialog: (window: unknown, options: unknown) => Promise<unknown> };
      dialogStub.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, fixturePath);
    await page.getByRole("button", { name: "Import Rekordbox XML" }).click();
    await expect(page.getByText("4 tracks imported and 4 playlists.")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(4);
  } finally {
    await application?.evaluate(({ dialog }) => {
      const original = Reflect.get(globalThis, "__DJ_COPILOT_ORIGINAL_DIALOG__");
      if (typeof original === "function") {
        (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = original;
      }
      Reflect.deleteProperty(globalThis, "__DJ_COPILOT_ORIGINAL_DIALOG__");
    }).catch(() => undefined);
    await application?.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});
