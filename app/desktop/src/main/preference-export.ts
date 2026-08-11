import { randomUUID } from "node:crypto";
import {
  lstat as nodeLstat,
  open as nodeOpen,
  readFile as nodeReadFile,
  realpath as nodeRealpath,
  rename as nodeRename,
  unlink as nodeUnlink,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import {
  preferenceExportConfirmResultSchema,
  preferenceExportPrepareResultSchema,
  preferenceExportSnapshotSchema,
  type PreferenceExportConfirmResult,
  type PreferenceExportPrepareResult,
  type PreferenceExportSnapshot,
} from "../shared/contracts";

interface PreferenceExportFileHandle {
  writeFile(data: string, options: { encoding: "utf8" }): Promise<void>;
  chmod(mode: number): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface PreferenceExportFileSystem {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>;
  open(path: string, flags: "wx", mode: number): Promise<PreferenceExportFileHandle>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface PreferenceExportCoordinatorDependencies {
  showSaveDialog(options: {
    defaultPath?: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePath?: string }>;
  fetchSnapshot(): Promise<unknown>;
  now?: () => number;
  createConfirmationId?: () => string;
  createTempId?: () => string;
  fileSystem?: PreferenceExportFileSystem;
}

export interface PreferenceExportCoordinator {
  prepare(): Promise<PreferenceExportPrepareResult>;
  confirm(confirmationId: string): Promise<PreferenceExportConfirmResult>;
}

type DestinationState = "absent" | "regular_file";

interface PendingConfirmation {
  revision: string;
  destinationPath: string;
  expectedDestinationState: DestinationState;
  expiresAt: number;
}

const CONFIRMATION_TTL_MS = 10 * 60 * 1_000;
const INVALID_CONFIRMATION = {
  status: "blocked" as const,
  reasons: [{
    code: "invalid_confirmation",
    message: "The preference export confirmation is unavailable or has expired",
  }],
  destinationState: "unchanged" as const,
};

const nodeFileSystem: PreferenceExportFileSystem = {
  realpath: nodeRealpath,
  lstat: nodeLstat,
  open: async (path, flags, mode) => nodeOpen(path, flags, mode),
  readFile: nodeReadFile,
  rename: nodeRename,
  unlink: nodeUnlink,
};

export function createPreferenceExportCoordinator(
  dependencies: PreferenceExportCoordinatorDependencies,
): PreferenceExportCoordinator {
  const now = dependencies.now ?? Date.now;
  const createConfirmationId = dependencies.createConfirmationId ?? randomUUID;
  const createTempId = dependencies.createTempId ?? randomUUID;
  const fileSystem = dependencies.fileSystem ?? nodeFileSystem;
  const confirmations = new Map<string, PendingConfirmation>();

  return {
    async prepare() {
      clearExpired(confirmations, now());
      const snapshot = parseSnapshot(await dependencies.fetchSnapshot());
      const choice = await dependencies.showSaveDialog({
        defaultPath: "dj-copilot-preferences.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (choice.canceled || !choice.filePath) {
        return preferenceExportPrepareResultSchema.parse({ status: "cancelled" });
      }

      let destinationPath: string;
      let expectedDestinationState: DestinationState;
      try {
        destinationPath = await canonicalJsonDestination(choice.filePath, fileSystem);
        expectedDestinationState = await destinationState(destinationPath, fileSystem);
      } catch {
        return blockedPrepare("invalid_destination", "The selected preference export destination is not a regular JSON file");
      }

      const confirmationId = createConfirmationId();
      confirmations.set(confirmationId, {
        revision: snapshot.revision,
        destinationPath,
        expectedDestinationState,
        expiresAt: now() + CONFIRMATION_TTL_MS,
      });
      return preferenceExportPrepareResultSchema.parse({
        status: "ready",
        confirmationId,
        destinationDisplay: basename(destinationPath),
        willReplaceExisting: expectedDestinationState === "regular_file",
        effectiveEvidenceCount: snapshot.effectiveEvidenceCount,
        profileStatus: snapshot.status,
      });
    },

    async confirm(confirmationId) {
      clearExpired(confirmations, now());
      const confirmation = confirmations.get(confirmationId);
      if (!confirmation) return preferenceExportConfirmResultSchema.parse(INVALID_CONFIRMATION);
      confirmations.delete(confirmationId);

      const snapshot = parseSnapshot(await dependencies.fetchSnapshot());
      if (snapshot.revision !== confirmation.revision) {
        return blockedConfirm(
          "profile_changed",
          "Preferences changed before confirmation; prepare the export again",
          "unchanged",
        );
      }

      if (!await destinationStillMatches(confirmation, fileSystem)) {
        return blockedConfirm(
          "destination_changed",
          "The preference export destination changed before confirmation",
          "unchanged",
        );
      }

      const temporaryPath = join(
        dirname(confirmation.destinationPath),
        `.${basename(confirmation.destinationPath)}.${createTempId()}.tmp`,
      );
      let renameAttempted = false;
      try {
        const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
        const handle = await fileSystem.open(temporaryPath, "wx", 0o600);
        try {
          await handle.writeFile(serialized, { encoding: "utf8" });
          await handle.chmod(0o600);
          await handle.sync();
        } finally {
          await handle.close();
        }

        const reparsed = JSON.parse(await fileSystem.readFile(temporaryPath, "utf8")) as unknown;
        preferenceExportSnapshotSchema.parse(reparsed);
        if (!await destinationStillMatches(confirmation, fileSystem)) {
          return blockedConfirm(
            "destination_changed",
            "The preference export destination changed before confirmation",
            "unchanged",
          );
        }

        renameAttempted = true;
        await fileSystem.rename(temporaryPath, confirmation.destinationPath);
        return preferenceExportConfirmResultSchema.parse({
          status: "exported",
          overwritten: confirmation.expectedDestinationState === "regular_file",
          format: "dj-copilot-preferences-v1",
          destinationState: "replaced",
        });
      } catch {
        return blockedConfirm(
          renameAttempted ? "export_outcome_unknown" : "export_failed",
          renameAttempted
            ? "The preference export outcome could not be confirmed"
            : "The preference export could not be written",
          renameAttempted ? "unknown" : "unchanged",
        );
      } finally {
        await ignoreMissing(() => fileSystem.unlink(temporaryPath));
      }
    },
  };
}

async function canonicalJsonDestination(
  selectedPath: string,
  fileSystem: PreferenceExportFileSystem,
): Promise<string> {
  if (!isAbsolute(selectedPath) || extname(selectedPath).toLowerCase() !== ".json") {
    throw new Error("Invalid JSON destination");
  }
  const candidate = resolve(selectedPath);
  const canonicalParent = await fileSystem.realpath(dirname(candidate));
  return join(canonicalParent, basename(candidate));
}

async function destinationState(
  destinationPath: string,
  fileSystem: PreferenceExportFileSystem,
): Promise<DestinationState> {
  try {
    const entry = await fileSystem.lstat(destinationPath);
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("Invalid destination type");
    return "regular_file";
  } catch (error) {
    if (isMissingPath(error)) return "absent";
    throw error;
  }
}

async function destinationStillMatches(
  confirmation: PendingConfirmation,
  fileSystem: PreferenceExportFileSystem,
): Promise<boolean> {
  try {
    return await destinationState(confirmation.destinationPath, fileSystem) === confirmation.expectedDestinationState;
  } catch {
    return false;
  }
}

function parseSnapshot(result: unknown): PreferenceExportSnapshot {
  const parsed = preferenceExportSnapshotSchema.safeParse(result);
  if (!parsed.success) throw new Error("Core response failed validation");
  return parsed.data;
}

function blockedPrepare(code: string, message: string): PreferenceExportPrepareResult {
  return preferenceExportPrepareResultSchema.parse({ status: "blocked", reasons: [{ code, message }] });
}

function blockedConfirm(
  code: string,
  message: string,
  destinationStateValue: "unchanged" | "unknown",
): PreferenceExportConfirmResult {
  return preferenceExportConfirmResultSchema.parse({
    status: "blocked",
    reasons: [{ code, message }],
    destinationState: destinationStateValue,
  });
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function ignoreMissing(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!isMissingPath(error)) return;
  }
}

function clearExpired<T extends { expiresAt: number }>(confirmations: Map<string, T>, now: number): void {
  for (const [confirmationId, confirmation] of confirmations) {
    if (confirmation.expiresAt <= now) confirmations.delete(confirmationId);
  }
}
