import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, TrackPageQuery } from "../shared/contracts";

interface IpcRendererLike {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

export function createDesktopApi(renderer: IpcRendererLike): DesktopApi {
  return Object.freeze({
    system: Object.freeze({
      getStatus: () => renderer.invoke("system:getStatus") as ReturnType<DesktopApi["system"]["getStatus"]>,
    }),
    library: Object.freeze({
      importXml: () => renderer.invoke("library:importXml") as ReturnType<DesktopApi["library"]["importXml"]>,
      getPlaylistTree: () => renderer.invoke("library:getPlaylistTree") as ReturnType<DesktopApi["library"]["getPlaylistTree"]>,
      listTracks: (query?: TrackPageQuery) => renderer.invoke("library:listTracks", query) as ReturnType<DesktopApi["library"]["listTracks"]>,
    }),
  });
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("djCopilot", createDesktopApi(ipcRenderer));
}
