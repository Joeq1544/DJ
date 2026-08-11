import { realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  analysisQueueRequestSchema,
  analysisQueueStatusSchema,
  analysisStatusQuerySchema,
  appStatusSchema,
  importResultSchema,
  playlistTreeSchema,
  trackPageQuerySchema,
  trackPageSchema,
  type AppStatus,
  type CoreRequest,
  type DesktopApi,
} from "../shared/contracts";
import { CoreServiceError } from "./core-client";

type IpcHandler = (event: { senderFrame: { url: string } | null }, payload?: unknown) => Promise<unknown>;

interface CoreRequester {
  request(command: CoreRequest["command"], payload: unknown): Promise<unknown>;
}

export interface IpcDependencies {
  ipcMain: { handle(channel: string, handler: IpcHandler): void };
  dialog: { showOpenDialog(window: unknown, options: { properties: ["openFile"]; filters: Array<{ name: string; extensions: string[] }> }): Promise<{ canceled: boolean; filePaths: string[] }> };
  getWindow(): unknown;
  repositoryRoot: string;
  rendererUrl: string;
  environment?: NodeJS.ProcessEnv;
  status(): AppStatus;
  client(): CoreRequester;
}

const UNTRUSTED_SENDER = "Untrusted IPC sender";
const INVALID_PAYLOAD = "Invalid IPC payload";

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  const env = dependencies.environment ?? process.env;
  const trust = (event: { senderFrame: { url: string } | null }) => {
    if (event.senderFrame?.url !== dependencies.rendererUrl) throw new Error(UNTRUSTED_SENDER);
  };
  const noPayload = (payload: unknown) => {
    if (payload !== undefined) throw new Error(INVALID_PAYLOAD);
  };
  const analysisResult = (result: unknown) => {
    const parsed = analysisQueueStatusSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  };
  dependencies.ipcMain.handle("system:getStatus", async (event, payload) => {
    trust(event);
    noPayload(payload);
    const parsed = appStatusSchema.safeParse(dependencies.status());
    if (!parsed.success) throw new Error("Core status is unavailable");
    return parsed.data;
  });
  dependencies.ipcMain.handle("library:importXml", async (event, payload) => {
    trust(event);
    noPayload(payload);
    const sourcePath = await chooseXmlPath(dependencies, env);
    if (!sourcePath) {
      return importResultSchema.parse({
        success: false,
        error: { code: "cancelled", message: "No XML selected" },
        preservedPreviousLibrary: true,
      });
    }
    try {
      const result = await dependencies.client().request("import_library", { sourcePath });
      const imported = importResultSchema.safeParse(result);
      if (!imported.success) throw new Error("Core import response failed validation");
      return imported.data;
    } catch (error) {
      if (error instanceof CoreServiceError) {
        return importResultSchema.parse({
          success: false,
          error: { code: error.code, message: error.message },
          preservedPreviousLibrary: true,
        });
      }
      return importResultSchema.parse({
        success: false,
        error: { code: "core_unavailable", message: "The library service is unavailable" },
        preservedPreviousLibrary: true,
      });
    }
  });
  dependencies.ipcMain.handle("library:getPlaylistTree", async (event, payload) => {
    trust(event);
    noPayload(payload);
    const result = await dependencies.client().request("get_playlist_tree", {});
    const parsed = playlistTreeSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("library:listTracks", async (event, payload) => {
    trust(event);
    const query = trackPageQuerySchema.safeParse(payload ?? {});
    if (!query.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("list_tracks", query.data);
    const parsed = trackPageSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("analysis:queue", async (event, payload) => {
    trust(event);
    const request = analysisQueueRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    return analysisResult(
      await dependencies.client().request("queue_analysis", request.data),
    );
  });
  dependencies.ipcMain.handle("analysis:getStatus", async (event, payload) => {
    trust(event);
    const request = analysisStatusQuerySchema.safeParse(payload === undefined ? {} : payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    return analysisResult(
      await dependencies.client().request("get_analysis_status", request.data),
    );
  });
  dependencies.ipcMain.handle("analysis:pause", async (event, payload) => {
    trust(event);
    noPayload(payload);
    return analysisResult(await dependencies.client().request("pause_analysis", {}));
  });
  dependencies.ipcMain.handle("analysis:resume", async (event, payload) => {
    trust(event);
    noPayload(payload);
    return analysisResult(await dependencies.client().request("resume_analysis", {}));
  });
}

async function chooseXmlPath(dependencies: IpcDependencies, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (env.DJ_COPILOT_TEST_MODE === "1" && env.DJ_COPILOT_TEST_XML) {
    const fixturesDirectory = await realpath(join(dependencies.repositoryRoot, "fixtures"));
    const candidate = await realpath(env.DJ_COPILOT_TEST_XML);
    const fixtureRelative = relative(fixturesDirectory, candidate);
    if (fixtureRelative === "" || fixtureRelative.startsWith("..") || fixtureRelative.includes("../")) {
      throw new Error("Invalid test XML path");
    }
    return candidate;
  }
  const choice = await dependencies.dialog.showOpenDialog(dependencies.getWindow(), {
    properties: ["openFile"],
    filters: [{ name: "Rekordbox XML", extensions: ["xml"] }],
  });
  return choice.canceled ? undefined : choice.filePaths[0];
}

export type IpcDesktopApi = DesktopApi;
