import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AssistantCoordinator } from "./assistant/coordinator";
import { CodexProvider, type CodexSdkModuleLike } from "./assistant/codex-provider";
import { createAssistantRuntime } from "./assistant/runtime";
import { CoreSupervisor } from "./core-supervisor";
import { createDiagnosticsBoundary, writeDiagnosticsSnapshot } from "./diagnostics";
import { registerIpcHandlers } from "./ipc";
import { resolveRuntimeLayout } from "./runtime-paths";
import { installGracefulShutdown } from "./shutdown";
import { createWindowOptions, installContentSecurityPolicy, installWindowSecurity } from "./window-security";

let supervisor: CoreSupervisor | undefined;
let assistantCoordinator: AssistantCoordinator | undefined;

function installTestHook(): void {
  if (process.env.DJ_COPILOT_TEST_MODE !== "1") return;
  Object.defineProperty(globalThis, "__DJ_COPILOT_TEST_HOOK__", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      forceCoreExit: () => {
        if (!supervisor) throw new Error("Core service is unavailable");
        return supervisor.forceCoreExitForTest();
      },
      getStatus: () => supervisor?.status() ?? { state: "degraded", message: "Core service is unavailable" },
      getRuntimeDirectory: () => supervisor?.runtimeDirectory(),
    }),
  });
}

async function createMainWindow(): Promise<void> {
  const runtimeLayout = resolveRuntimeLayout({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    compiledDirectory: __dirname,
  });
  const { repositoryRoot, packagedResourcesPath, codexSdkPackageDirectory } = runtimeLayout;
  const devRendererUrl = process.env.VITE_DEV_SERVER_URL;
  const isDevelopment = devRendererUrl === "http://127.0.0.1:5173";
  const rendererUrl = isDevelopment
    ? new URL(devRendererUrl).href
    : pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  const preloadPath = join(__dirname, "../preload/index.cjs");
  supervisor = new CoreSupervisor({
    userDataPath: app.getPath("userData"),
    repositoryRoot,
    ...(packagedResourcesPath === undefined ? {} : { packagedResourcesPath }),
  });
  await supervisor.start();
  const assistantRuntime = await createAssistantRuntime({
    environment: process.env,
    workingDirectory: join(app.getPath("userData"), "assistant-workspace"),
    client: () => {
      if (!supervisor) throw new Error("Core service is unavailable");
      return supervisor.getClient();
    },
    ...(codexSdkPackageDirectory === undefined ? {} : {
      loadCodexProvider: async (workingDirectory: string) => new CodexProvider({
        workingDirectory,
        sdkPackageDirectory: codexSdkPackageDirectory,
        loadSdk: async () => import(
          pathToFileURL(join(codexSdkPackageDirectory, "dist", "index.js")).href
        ) as unknown as Promise<CodexSdkModuleLike>,
      }),
    }),
  });
  assistantCoordinator = assistantRuntime.coordinator;
  installTestHook();
  installContentSecurityPolicy(session.defaultSession, isDevelopment);
  const window = new BrowserWindow(createWindowOptions(preloadPath));
  installWindowSecurity(window.webContents, rendererUrl);
  const userDataPath = app.getPath("userData");
  const diagnostics = createDiagnosticsBoundary({
    releaseMode: app.isPackaged ? "personal_arm64" : "development",
    ...(packagedResourcesPath === undefined ? {} : { resourcesPath: packagedResourcesPath }),
    repositoryRoot,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    architecture: process.arch,
  });
  registerIpcHandlers({
    ipcMain,
    dialog,
    getWindow: () => window,
    repositoryRoot,
    rendererUrl,
    userDataPath,
    shell: { openPath: (path) => shell.openPath(path) },
    diagnostics: {
      getSnapshot: (core) => diagnostics.getSnapshot(core),
      writeSnapshot: (destinationPath, snapshot) => writeDiagnosticsSnapshot(destinationPath, snapshot),
    },
    status: () => supervisor?.status() ?? { state: "degraded", message: "Core service is unavailable" },
    assistant: assistantCoordinator,
    client: () => {
      if (!supervisor) throw new Error("Core service is unavailable");
      return supervisor.getClient();
    },
  });
  await window.loadURL(rendererUrl);
}

app.whenReady().then(createMainWindow);
installGracefulShutdown(
  { on: (event, listener) => app.on(event, listener), quit: () => app.quit() },
  async () => {
    assistantCoordinator?.shutdown();
    await supervisor?.stop();
  },
);
