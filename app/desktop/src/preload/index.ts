import { contextBridge, ipcRenderer } from "electron";
import type {
  CompareRecommendationsRequest,
  DesktopApi,
  ExportConfirmResult,
  ExportPrepareResult,
  FindSimilarRequest,
  RecommendNextRequest,
  RecordFeedbackRequest,
  SavedFilterSaveRequest,
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
  TrackMetadataUpdateRequest,
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
      getTrackMetadata: (trackId: string) => renderer.invoke("library:getTrackMetadata", { trackId }) as ReturnType<DesktopApi["library"]["getTrackMetadata"]>,
      updateTrackMetadata: (request: TrackMetadataUpdateRequest) => renderer.invoke("library:updateTrackMetadata", request) as ReturnType<DesktopApi["library"]["updateTrackMetadata"]>,
      listSavedFilters: () => renderer.invoke("library:listSavedFilters") as ReturnType<DesktopApi["library"]["listSavedFilters"]>,
      saveSavedFilter: (request: SavedFilterSaveRequest) => renderer.invoke("library:saveSavedFilter", request) as ReturnType<DesktopApi["library"]["saveSavedFilter"]>,
      deleteSavedFilter: (id: string) => renderer.invoke("library:deleteSavedFilter", { id }) as ReturnType<DesktopApi["library"]["deleteSavedFilter"]>,
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
    preferences: Object.freeze({
      getProfile: () => renderer.invoke("preferences:getProfile") as ReturnType<DesktopApi["preferences"]["getProfile"]>,
      recordFeedback: (request: RecordFeedbackRequest) => renderer.invoke("preferences:recordFeedback", request) as ReturnType<DesktopApi["preferences"]["recordFeedback"]>,
      compareRecommendations: (request: CompareRecommendationsRequest) => renderer.invoke("preferences:compareRecommendations", request) as ReturnType<DesktopApi["preferences"]["compareRecommendations"]>,
      reset: () => renderer.invoke("preferences:reset") as ReturnType<DesktopApi["preferences"]["reset"]>,
      prepareExport: () => renderer.invoke("preferences:prepareExport") as ReturnType<DesktopApi["preferences"]["prepareExport"]>,
      confirmExport: (confirmationId: string) => renderer.invoke("preferences:confirmExport", { confirmationId }) as ReturnType<DesktopApi["preferences"]["confirmExport"]>,
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
