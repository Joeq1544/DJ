import { randomUUID } from "node:crypto";
import { lstat as nodeLstat, realpath as nodeRealpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  analysisQueueRequestSchema,
  analysisQueueStatusSchema,
  analysisStatusQuerySchema,
  assistantAuthStatusSchema,
  assistantCancelRequestSchema,
  assistantCancelResultSchema,
  assistantConfirmRequestSchema,
  assistantConfirmResultSchema,
  assistantPollRequestSchema,
  assistantPollResultSchema,
  assistantStartResultSchema,
  assistantTaskRequestSchema,
  appStatusSchema,
  compareRecommendationsRequestSchema,
  compareRecommendationsResponseSchema,
  coreDiagnosticsSchema,
  databaseBackupResultSchema,
  diagnosticsExportResultSchema,
  diagnosticsSnapshotSchema,
  findSimilarRequestSchema,
  importResultSchema,
  playlistTreeSchema,
  preferenceExportConfirmRequestSchema,
  preferenceExportConfirmResultSchema,
  preferenceExportPrepareResultSchema,
  preferenceProfileSchema,
  preferenceResetResultSchema,
  recommendationResponseSchema,
  recommendNextRequestSchema,
  recordFeedbackRequestSchema,
  recordFeedbackResultSchema,
  savedFilterDeleteRequestSchema,
  savedFilterDeleteResultSchema,
  savedFilterListSchema,
  savedFilterSaveRequestSchema,
  savedFilterSchema,
  exportConfirmRequestSchema,
  exportConfirmResultSchema,
  exportPrepareRequestSchema,
  exportPrepareResultSchema,
  privateExportPreviewRequestSchema,
  privateExportPreviewResultSchema,
  privateDatabaseBackupResultSchema,
  setDraftCreateRequestSchema,
  setDraftGetRequestSchema,
  setDraftInspectRequestSchema,
  setDraftInspectResultSchema,
  setDraftListResultSchema,
  setDraftMutationRequestSchema,
  setDraftMutationResultSchema,
  setDraftReplacementRequestSchema,
  setDraftReplacementResultSchema,
  setDraftSnapshotSchema,
  similarityResponseSchema,
  showDataFolderResultSchema,
  trackPageQuerySchema,
  trackPageSchema,
  trackMetadataGetRequestSchema,
  trackMetadataSchema,
  trackMetadataUpdateRequestSchema,
  type AppStatus,
  type AssistantAuthStatus,
  type AssistantCancelResult,
  type AssistantConfirmResult,
  type AssistantPollResult,
  type AssistantStartResult,
  type AssistantTaskRequest,
  type CoreRequest,
  type CoreDiagnostics,
  type DesktopApi,
  type DiagnosticsSnapshot,
} from "../shared/contracts";
import { CoreServiceError } from "./core-client";
import { createPreferenceExportCoordinator } from "./preference-export";

type IpcHandler = (event: { senderFrame: { url: string } | null }, payload?: unknown) => Promise<unknown>;

interface CoreRequester {
  request(command: CoreRequest["command"], payload: unknown): Promise<unknown>;
}

interface AssistantBoundary {
  getStatus(): Promise<AssistantAuthStatus>;
  beginLogin(): Promise<AssistantAuthStatus>;
  start(request: AssistantTaskRequest): AssistantStartResult;
  poll(requestId: string, afterSequence: number): AssistantPollResult;
  cancel(requestId: string): AssistantCancelResult;
  confirm(requestId: string, proposalId: string): Promise<AssistantConfirmResult>;
}

interface DiagnosticsBoundary {
  getSnapshot(core: CoreDiagnostics): Promise<unknown>;
  writeSnapshot(
    destinationPath: string,
    snapshot: DiagnosticsSnapshot,
  ): Promise<{ sizeBytes: number; createdAt: string }>;
}

export interface IpcDependencies {
  ipcMain: { handle(channel: string, handler: IpcHandler): void };
  dialog: {
    showOpenDialog(window: unknown, options: { properties: ["openFile"]; filters: Array<{ name: string; extensions: string[] }> }): Promise<{ canceled: boolean; filePaths: string[] }>;
    showSaveDialog?(window: unknown, options: { defaultPath?: string; filters: Array<{ name: string; extensions: string[] }> }): Promise<{ canceled: boolean; filePath?: string }>;
  };
  getWindow(): unknown;
  repositoryRoot: string;
  rendererUrl: string;
  environment?: NodeJS.ProcessEnv;
  status(): AppStatus;
  client(): CoreRequester;
  assistant?: AssistantBoundary;
  diagnostics?: DiagnosticsBoundary;
  userDataPath?: string;
  shell?: { openPath(path: string): Promise<string> };
  now?(): number;
  createConfirmationId?(): string;
  lstat?(path: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>;
  realpath?(path: string): Promise<string>;
}

const UNTRUSTED_SENDER = "Untrusted IPC sender";
const INVALID_PAYLOAD = "Invalid IPC payload";
const EXPORT_CONFIRMATION_TTL_MS = 10 * 60 * 1_000;

interface PendingExportConfirmation {
  draftId: string;
  expectedRevision: number;
  destinationPath: string;
  expectedDestinationState: "absent" | "regular_file";
  expiresAt: number;
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  const env = dependencies.environment ?? process.env;
  const now = dependencies.now ?? Date.now;
  const newConfirmationId = dependencies.createConfirmationId ?? randomUUID;
  const lstat = dependencies.lstat ?? nodeLstat;
  const canonicalize = dependencies.realpath ?? nodeRealpath;
  const confirmations = new Map<string, PendingExportConfirmation>();
  const preferenceExport = createPreferenceExportCoordinator({
    showSaveDialog: async (options) => {
      const showSaveDialog = dependencies.dialog.showSaveDialog;
      if (!showSaveDialog) throw new Error("Export dialog is unavailable");
      return showSaveDialog(dependencies.getWindow(), options);
    },
    fetchSnapshot: () => dependencies.client().request("get_preference_export", {}),
    now,
    createConfirmationId: newConfirmationId,
  });
  const clearExpiredConfirmations = () => {
    const currentTime = now();
    for (const [confirmationId, confirmation] of confirmations) {
      if (confirmation.expiresAt <= currentTime) confirmations.delete(confirmationId);
    }
  };
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
  const assistantBoundary = () => {
    if (!dependencies.assistant) throw new Error("Assistant is unavailable");
    return dependencies.assistant;
  };
  const diagnosticsBoundary = () => {
    if (!dependencies.diagnostics) throw new Error("Diagnostics are unavailable");
    return dependencies.diagnostics;
  };
  const loadDiagnosticsSnapshot = async () => {
    let rawCoreResult: unknown;
    try {
      rawCoreResult = await dependencies.client().request("get_diagnostics", {});
    } catch {
      throw new Error("Diagnostics are unavailable");
    }
    const coreResult = coreDiagnosticsSchema.safeParse(rawCoreResult);
    if (!coreResult.success) throw new Error("Core response failed validation");
    let rawSnapshot: unknown;
    try {
      rawSnapshot = await diagnosticsBoundary().getSnapshot(coreResult.data);
    } catch {
      throw new Error("Diagnostics are unavailable");
    }
    const snapshot = diagnosticsSnapshotSchema.safeParse(rawSnapshot);
    if (!snapshot.success) throw new Error("Diagnostics response failed validation");
    return snapshot.data;
  };
  const assistantResult = <Output>(
    schema: { safeParse(value: unknown): { success: true; data: Output } | { success: false } },
    result: unknown,
  ): Output => {
    const parsed = schema.safeParse(result);
    if (!parsed.success) throw new Error("Assistant response failed validation");
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
  dependencies.ipcMain.handle("library:getTrackMetadata", async (event, payload) => {
    trust(event);
    const request = trackMetadataGetRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("get_track_metadata", request.data);
    const parsed = trackMetadataSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("library:updateTrackMetadata", async (event, payload) => {
    trust(event);
    const request = trackMetadataUpdateRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("update_track_metadata", request.data);
    const parsed = trackMetadataSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("library:listSavedFilters", async (event, payload) => {
    trust(event);
    noPayload(payload);
    const result = await dependencies.client().request("list_saved_filters", {});
    const parsed = savedFilterListSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("library:saveSavedFilter", async (event, payload) => {
    trust(event);
    const request = savedFilterSaveRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("save_saved_filter", request.data);
    const parsed = savedFilterSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("library:deleteSavedFilter", async (event, payload) => {
    trust(event);
    const request = savedFilterDeleteRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("delete_saved_filter", request.data);
    const parsed = savedFilterDeleteResultSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("discovery:findSimilar", async (event, payload) => {
    trust(event);
    const request = findSimilarRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("find_similar_tracks", request.data);
    const parsed = similarityResponseSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("discovery:recommendNext", async (event, payload) => {
    trust(event);
    const request = recommendNextRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("recommend_next_tracks", request.data);
    const parsed = recommendationResponseSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("preferences:getProfile", async (event, payload) => {
    trust(event);
    noPayload(payload);
    const result = await dependencies.client().request("get_preference_profile", {});
    const parsed = preferenceProfileSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("preferences:recordFeedback", async (event, payload) => {
    trust(event);
    const request = recordFeedbackRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("record_feedback", request.data);
    const parsed = recordFeedbackResultSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("preferences:compareRecommendations", async (event, payload) => {
    trust(event);
    const request = compareRecommendationsRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("compare_recommendations", request.data);
    const parsed = compareRecommendationsResponseSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("preferences:reset", async (event, payload) => {
    trust(event);
    noPayload(payload);
    const result = await dependencies.client().request("reset_preferences", {});
    const parsed = preferenceResetResultSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("preferences:prepareExport", async (event, payload) => {
    trust(event);
    noPayload(payload);
    return preferenceExportPrepareResultSchema.parse(await preferenceExport.prepare());
  });
  dependencies.ipcMain.handle("preferences:confirmExport", async (event, payload) => {
    trust(event);
    const request = preferenceExportConfirmRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    return preferenceExportConfirmResultSchema.parse(await preferenceExport.confirm(request.data.confirmationId));
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
  dependencies.ipcMain.handle("analysis:rebuild", async (event, payload) => {
    trust(event);
    const request = analysisQueueRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    return analysisResult(
      await dependencies.client().request("rebuild_analysis", request.data),
    );
  });
  dependencies.ipcMain.handle("assistant:getStatus", async (event, payload) => {
    trust(event);
    noPayload(payload);
    return assistantResult(assistantAuthStatusSchema, await assistantBoundary().getStatus());
  });
  dependencies.ipcMain.handle("assistant:beginLogin", async (event, payload) => {
    trust(event);
    noPayload(payload);
    return assistantResult(assistantAuthStatusSchema, await assistantBoundary().beginLogin());
  });
  dependencies.ipcMain.handle("assistant:start", async (event, payload) => {
    trust(event);
    const request = assistantTaskRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    return assistantResult(assistantStartResultSchema, assistantBoundary().start(request.data));
  });
  dependencies.ipcMain.handle("assistant:poll", async (event, payload) => {
    trust(event);
    const request = assistantPollRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    return assistantResult(
      assistantPollResultSchema,
      assistantBoundary().poll(request.data.requestId, request.data.afterSequence),
    );
  });
  dependencies.ipcMain.handle("assistant:cancel", async (event, payload) => {
    trust(event);
    const request = assistantCancelRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    return assistantResult(assistantCancelResultSchema, assistantBoundary().cancel(request.data.requestId));
  });
  dependencies.ipcMain.handle("assistant:confirm", async (event, payload) => {
    trust(event);
    const request = assistantConfirmRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    return assistantResult(
      assistantConfirmResultSchema,
      await assistantBoundary().confirm(request.data.requestId, request.data.proposalId),
    );
  });
  dependencies.ipcMain.handle("sets:list", async (event, payload) => {
    trust(event);
    noPayload(payload);
    const result = await dependencies.client().request("list_set_drafts", {});
    const parsed = setDraftListResultSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("sets:create", async (event, payload) => {
    trust(event);
    const request = setDraftCreateRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("create_set_draft", request.data);
    const parsed = setDraftSnapshotSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("sets:get", async (event, payload) => {
    trust(event);
    const request = setDraftGetRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("get_set_draft", request.data);
    const parsed = setDraftSnapshotSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("sets:mutate", async (event, payload) => {
    trust(event);
    const request = setDraftMutationRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("mutate_set_draft", request.data);
    const parsed = setDraftMutationResultSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("sets:findReplacements", async (event, payload) => {
    trust(event);
    const request = setDraftReplacementRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("find_set_replacements", request.data);
    const parsed = setDraftReplacementResultSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("sets:inspect", async (event, payload) => {
    trust(event);
    const request = setDraftInspectRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const result = await dependencies.client().request("analyze_set", request.data);
    const parsed = setDraftInspectResultSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return parsed.data;
  });
  dependencies.ipcMain.handle("exports:prepare", async (event, payload) => {
    trust(event);
    clearExpiredConfirmations();
    const request = exportPrepareRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    let destinationPath: string | undefined;
    try {
      destinationPath = await chooseSaveXmlPath(dependencies, canonicalize);
    } catch {
      return exportPrepareResultSchema.parse({
        status: "blocked",
        reasons: [{ code: "invalid_destination", message: "The selected export destination is not a regular XML file" }],
      });
    }
    if (!destinationPath) return exportPrepareResultSchema.parse({ status: "cancelled" });
    let expectedDestinationState: "absent" | "regular_file";
    try {
      expectedDestinationState = await destinationState(destinationPath, lstat);
    } catch {
      return exportPrepareResultSchema.parse({
        status: "blocked",
        reasons: [{ code: "invalid_destination", message: "The selected export destination is not a regular XML file" }],
      });
    }
    const previewPayload = { ...request.data, destinationPath, expectedDestinationState };
    const privateRequest = privateExportPreviewRequestSchema.safeParse(previewPayload);
    if (!privateRequest.success) throw new Error("Invalid private export request");
    let preview: unknown;
    try {
      preview = await dependencies.client().request("preview_set_export", privateRequest.data);
    } catch (error) {
      return exportPrepareResultSchema.parse({
        status: "blocked",
        reasons: [errorReason(error)],
      });
    }
    const parsed = privateExportPreviewResultSchema.safeParse(preview);
    if (!parsed.success) throw new Error("Core response failed validation");
    if (parsed.data.status === "blocked") return exportPrepareResultSchema.parse({ status: "blocked", reasons: parsed.data.reasons });
    if (
      parsed.data.draftId !== request.data.draftId ||
      parsed.data.revision !== request.data.expectedRevision ||
      parsed.data.expectedDestinationState !== expectedDestinationState
    ) {
      throw new Error("Core response failed validation");
    }
    const confirmationId = newConfirmationId();
    const confirmation: PendingExportConfirmation = {
      draftId: request.data.draftId,
      expectedRevision: request.data.expectedRevision,
      destinationPath,
      expectedDestinationState,
      expiresAt: now() + EXPORT_CONFIRMATION_TTL_MS,
    };
    confirmations.set(confirmationId, confirmation);
    const expiryTimer = setTimeout(() => {
      if (confirmations.get(confirmationId) === confirmation) confirmations.delete(confirmationId);
    }, EXPORT_CONFIRMATION_TTL_MS);
    expiryTimer.unref?.();
    return exportPrepareResultSchema.parse({
      status: "ready",
      confirmationId,
      playlistName: parsed.data.playlistName,
      trackCount: parsed.data.trackCount,
      knownDurationMs: parsed.data.knownDurationMs,
      unknownDurationCount: parsed.data.unknownDurationCount,
      destinationDisplay: basename(destinationPath),
      willReplaceExisting: expectedDestinationState === "regular_file",
      warnings: parsed.data.warnings,
    });
  });
  dependencies.ipcMain.handle("exports:confirm", async (event, payload) => {
    trust(event);
    clearExpiredConfirmations();
    const request = exportConfirmRequestSchema.safeParse(payload);
    if (!request.success) throw new Error(INVALID_PAYLOAD);
    const confirmation = confirmations.get(request.data.confirmationId);
    if (!confirmation) return unavailableConfirmation();
    confirmations.delete(request.data.confirmationId);
    let actualDestinationState: "absent" | "regular_file";
    try {
      actualDestinationState = await destinationState(confirmation.destinationPath, lstat);
    } catch {
      return exportConfirmResultSchema.parse(destinationBlocked("invalid_destination", "The selected export destination is no longer usable", "unchanged"));
    }
    if (actualDestinationState !== confirmation.expectedDestinationState) {
      return exportConfirmResultSchema.parse(destinationBlocked("destination_changed", "The export destination changed before confirmation", "unchanged"));
    }
    try {
      const result = await dependencies.client().request("export_set_draft", {
        draftId: confirmation.draftId,
        expectedRevision: confirmation.expectedRevision,
        destinationPath: confirmation.destinationPath,
        expectedDestinationState: confirmation.expectedDestinationState,
      });
      const parsed = exportConfirmResultSchema.safeParse(result);
      if (!parsed.success) throw new Error("Core response failed validation");
      if (parsed.data.status === "exported" && (
        parsed.data.draftId !== confirmation.draftId || parsed.data.revision !== confirmation.expectedRevision
      )) {
        throw new Error("Core response failed validation");
      }
      return parsed.data;
    } catch {
      return exportConfirmResultSchema.parse(destinationBlocked("export_outcome_unknown", "The export outcome could not be confirmed", "unknown"));
    }
  });
  dependencies.ipcMain.handle("diagnostics:getSnapshot", async (event, payload) => {
    trust(event);
    noPayload(payload);
    return loadDiagnosticsSnapshot();
  });
  dependencies.ipcMain.handle("diagnostics:backupDatabase", async (event, payload) => {
    trust(event);
    noPayload(payload);
    let destinationPath: string | undefined;
    try {
      destinationPath = await chooseMainOwnedSavePath(
        dependencies,
        canonicalize,
        {
          label: "DJ Copilot database",
          extension: "sqlite3",
          defaultPath: "DJ Copilot Backup.sqlite3",
        },
      );
    } catch {
      throw new Error("Backup destination is unavailable");
    }
    if (!destinationPath) return databaseBackupResultSchema.parse({ status: "cancelled" });
    let result: unknown;
    try {
      result = await dependencies.client().request("backup_database", { destinationPath });
    } catch {
      throw new Error("Database backup failed");
    }
    const parsed = privateDatabaseBackupResultSchema.safeParse(result);
    if (!parsed.success) throw new Error("Core response failed validation");
    return databaseBackupResultSchema.parse({
      ...parsed.data,
      fileName: basename(destinationPath),
    });
  });
  dependencies.ipcMain.handle("diagnostics:exportBundle", async (event, payload) => {
    trust(event);
    noPayload(payload);
    let destinationPath: string | undefined;
    try {
      destinationPath = await chooseMainOwnedSavePath(
        dependencies,
        canonicalize,
        {
          label: "DJ Copilot diagnostics",
          extension: "json",
          defaultPath: "DJ Copilot Diagnostics.json",
        },
      );
    } catch {
      throw new Error("Diagnostics destination is unavailable");
    }
    if (!destinationPath) return diagnosticsExportResultSchema.parse({ status: "cancelled" });
    const snapshot = await loadDiagnosticsSnapshot();
    let written: { sizeBytes: number; createdAt: string };
    try {
      written = await diagnosticsBoundary().writeSnapshot(destinationPath, snapshot);
    } catch {
      throw new Error("Diagnostics export failed");
    }
    return diagnosticsExportResultSchema.parse({
      status: "exported",
      fileName: basename(destinationPath),
      sizeBytes: written.sizeBytes,
      createdAt: written.createdAt,
    });
  });
  dependencies.ipcMain.handle("diagnostics:showDataFolder", async (event, payload) => {
    trust(event);
    noPayload(payload);
    if (!dependencies.shell || !dependencies.userDataPath) throw new Error("Data folder is unavailable");
    const error = await dependencies.shell.openPath(dependencies.userDataPath);
    if (error !== "") throw new Error("Data folder could not be opened");
    return showDataFolderResultSchema.parse({ opened: true });
  });
}

async function chooseXmlPath(dependencies: IpcDependencies, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (env.DJ_COPILOT_TEST_MODE === "1" && env.DJ_COPILOT_TEST_XML) {
    const fixturesDirectory = await nodeRealpath(join(dependencies.repositoryRoot, "fixtures"));
    const candidate = await nodeRealpath(env.DJ_COPILOT_TEST_XML);
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

async function chooseSaveXmlPath(
  dependencies: IpcDependencies,
  canonicalize: (path: string) => Promise<string>,
): Promise<string | undefined> {
  const showSaveDialog = dependencies.dialog.showSaveDialog;
  if (!showSaveDialog) throw new Error("Export dialog is unavailable");
  const choice = await showSaveDialog(dependencies.getWindow(), {
    filters: [{ name: "Rekordbox XML", extensions: ["xml"] }],
  });
  if (choice.canceled || !choice.filePath) return undefined;
  if (!isAbsolute(choice.filePath) || extname(choice.filePath).toLowerCase() !== ".xml") {
    throw new Error("Invalid export destination");
  }
  const candidate = resolve(choice.filePath);
  const canonicalParent = await canonicalize(dirname(candidate));
  return join(canonicalParent, basename(candidate));
}

async function chooseMainOwnedSavePath(
  dependencies: IpcDependencies,
  canonicalize: (path: string) => Promise<string>,
  options: { label: string; extension: string; defaultPath: string },
): Promise<string | undefined> {
  const showSaveDialog = dependencies.dialog.showSaveDialog;
  if (!showSaveDialog) throw new Error("Save dialog is unavailable");
  const choice = await showSaveDialog(dependencies.getWindow(), {
    defaultPath: options.defaultPath,
    filters: [{ name: options.label, extensions: [options.extension] }],
  });
  if (choice.canceled || !choice.filePath) return undefined;
  if (
    !isAbsolute(choice.filePath)
    || extname(choice.filePath).toLowerCase() !== `.${options.extension}`
  ) {
    throw new Error("Invalid save destination");
  }
  const candidate = resolve(choice.filePath);
  const canonicalParent = await canonicalize(dirname(candidate));
  return join(canonicalParent, basename(candidate));
}

async function destinationState(
  destinationPath: string,
  lstat: (path: string) => Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>,
): Promise<"absent" | "regular_file"> {
  try {
    const entry = await lstat(destinationPath);
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("Invalid destination type");
    return "regular_file";
  } catch (error) {
    if (isMissingPath(error)) return "absent";
    throw error;
  }
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorReason(error: unknown): { code: string; message: string } {
  if (error instanceof CoreServiceError) return { code: error.code, message: error.message };
  return { code: "core_unavailable", message: "The export service is unavailable" };
}

function destinationBlocked(code: string, message: string, destinationState: "unchanged" | "unknown") {
  return { status: "blocked" as const, reasons: [{ code, message }], destinationState };
}

function unavailableConfirmation() {
  return exportConfirmResultSchema.parse(destinationBlocked(
    "invalid_confirmation",
    "The export confirmation is unavailable or has expired",
    "unchanged",
  ));
}

export type IpcDesktopApi = DesktopApi;
