import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CoreSupervisor } from "./core-supervisor";
import { registerIpcHandlers } from "./ipc";
import { installGracefulShutdown } from "./shutdown";
import { createWindowOptions, installContentSecurityPolicy, installWindowSecurity } from "./window-security";

let supervisor: CoreSupervisor | undefined;

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
  const repositoryRoot = app.isPackaged ? process.resourcesPath : resolve(__dirname, "../../../..");
  const devRendererUrl = process.env.VITE_DEV_SERVER_URL;
  const isDevelopment = devRendererUrl === "http://127.0.0.1:5173";
  const rendererUrl = isDevelopment
    ? new URL(devRendererUrl).href
    : pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  const preloadPath = join(__dirname, "../preload/index.cjs");
  supervisor = new CoreSupervisor({
    userDataPath: app.getPath("userData"),
    repositoryRoot,
  });
  await supervisor.start();
  installTestHook();
  installContentSecurityPolicy(session.defaultSession, isDevelopment);
  const window = new BrowserWindow(createWindowOptions(preloadPath));
  installWindowSecurity(window.webContents, rendererUrl);
  registerIpcHandlers({
    ipcMain,
    dialog,
    getWindow: () => window,
    repositoryRoot,
    rendererUrl,
    status: () => supervisor?.status() ?? { state: "degraded", message: "Core service is unavailable" },
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
  async () => { await supervisor?.stop(); },
);
