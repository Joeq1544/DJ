import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopApi,
  ExportConfirmResult,
  ExportPrepareResult,
  FindSimilarRequest,
  RecommendNextRequest,
  SetDraftCreateRequest,
  SetDraftGetRequest,
  SetDraftInspectRequest,
  SetDraftListResult,
  SetDraftMutationRequest,
  SetDraftMutationResult,
  SetDraftReplacementRequest,
  SetDraftReplacementResult,
  SetDraftSnapshot,
  TrackPageQuery,
} from "../shared/contracts";

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
    analysis: Object.freeze({
      queue: (trackIds: string[]) => renderer.invoke("analysis:queue", { trackIds }) as ReturnType<DesktopApi["analysis"]["queue"]>,
      getStatus: (trackIds?: string[]) => renderer.invoke("analysis:getStatus", trackIds === undefined ? undefined : { trackIds }) as ReturnType<DesktopApi["analysis"]["getStatus"]>,
      pause: () => renderer.invoke("analysis:pause") as ReturnType<DesktopApi["analysis"]["pause"]>,
      resume: () => renderer.invoke("analysis:resume") as ReturnType<DesktopApi["analysis"]["resume"]>,
    }),
    discovery: Object.freeze({
      findSimilar: (request: FindSimilarRequest) => renderer.invoke("discovery:findSimilar", request) as ReturnType<DesktopApi["discovery"]["findSimilar"]>,
      recommendNext: (request: RecommendNextRequest) => renderer.invoke("discovery:recommendNext", request) as ReturnType<DesktopApi["discovery"]["recommendNext"]>,
    }),
    sets: Object.freeze({
      list: () => renderer.invoke("sets:list") as Promise<SetDraftListResult>,
      create: (request: SetDraftCreateRequest) => renderer.invoke("sets:create", request) as Promise<SetDraftSnapshot>,
      get: (request: SetDraftGetRequest) => renderer.invoke("sets:get", request) as Promise<SetDraftSnapshot>,
      mutate: (request: SetDraftMutationRequest) => renderer.invoke("sets:mutate", request) as Promise<SetDraftMutationResult>,
      findReplacements: (request: SetDraftReplacementRequest) => renderer.invoke("sets:findReplacements", request) as Promise<SetDraftReplacementResult>,
      inspect: (request: SetDraftInspectRequest) => renderer.invoke("sets:inspect", request) as ReturnType<DesktopApi["sets"]["inspect"]>,
    }),
    exports: Object.freeze({
      prepare: (request: { draftId: string; expectedRevision: number }) => renderer.invoke("exports:prepare", request) as Promise<ExportPrepareResult>,
      confirm: (request: { confirmationId: string }) => renderer.invoke("exports:confirm", request) as Promise<ExportConfirmResult>,
    }),
  });
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("djCopilot", createDesktopApi(ipcRenderer));
}
