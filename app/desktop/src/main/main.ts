import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CoreSupervisor } from "./core-supervisor";
import { registerIpcHandlers } from "./ipc";
import { createWindowOptions, installContentSecurityPolicy, installWindowSecurity } from "./window-security";

let supervisor: CoreSupervisor | undefined;

async function createMainWindow(): Promise<void> {
  const repositoryRoot = app.isPackaged ? process.resourcesPath : resolve(__dirname, "../../..");
  const devRendererUrl = process.env.VITE_DEV_SERVER_URL;
  const rendererUrl = devRendererUrl === "http://127.0.0.1:5173"
    ? devRendererUrl
    : pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  const preloadPath = join(__dirname, "../preload/index.cjs");
  supervisor = new CoreSupervisor({
    userDataPath: app.getPath("userData"),
    repositoryRoot,
  });
  await supervisor.start();
  installContentSecurityPolicy(session.defaultSession);
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
app.on("before-quit", () => {
  void supervisor?.stop();
});
