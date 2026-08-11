import { randomUUID } from "node:crypto";
import {
  assistantAuthStatusSchema,
  assistantCancelResultSchema,
  assistantConfirmResultSchema,
  assistantEventSchema,
  assistantPollResultSchema,
  assistantProposalSchema,
  assistantSearchResultSchema,
  assistantStartResultSchema,
  findSimilarRequestSchema,
  recommendationResponseSchema,
  recommendNextRequestSchema,
  setDraftCreateRequestSchema,
  setDraftInspectRequestSchema,
  setDraftInspectResultSchema,
  setDraftMutationRequestSchema,
  setDraftMutationResultSchema,
  setDraftReplacementRequestSchema,
  setDraftReplacementResultSchema,
  setDraftSnapshotSchema,
  similarityResponseSchema,
  trackPageQuerySchema,
  trackPageSchema,
  type AssistantAuthStatus,
  type AssistantCancelResult,
  type AssistantConfirmResult,
  type AssistantEvent,
  type AssistantPollResult,
  type AssistantProposal,
  type AssistantStartResult,
  type AssistantTaskRequest,
  type CoreRequest,
  type SetDraftMutationRequest,
  type SetDraftSnapshot,
} from "../../shared/contracts";
import { CoreServiceError } from "../core-client";
import {
  ASSISTANT_EVIDENCE_TRACK_LIMIT,
  buildDiscoveryContext,
  buildDraftContext,
  buildDraftExplanationContext,
  buildSelectedTrackContext,
} from "./context";
import {
  AIProviderError,
  type AIProvider,
} from "./provider";
import {
  buildAssistantPrompt,
  validateGroundedExplanation,
  validateGroundedExplanationSnapshot,
} from "./prompts";
import {
  assistantPlanOutputSchema,
  assistantRevisionOutputSchema,
  assistantSearchOutputSchema,
  type AssistantPlanOutput,
  type AssistantRevisionOutput,
} from "./schemas";

const REQUEST_TTL_MS = 10 * 60 * 1_000;
const MAX_REQUESTS = 20;
const MAX_EVENTS_PER_REQUEST = 50;

type AssistantFailureCode = Extract<
  AssistantEvent,
  { type: "failed" }
>["error"]["code"];

type AssistantEventInput = AssistantEvent extends infer Event
  ? Event extends { sequence: number }
    ? Omit<Event, "sequence">
    : never
  : never;

interface CoreRequester {
  request(command: CoreRequest["command"], payload: unknown): Promise<unknown>;
}

export interface AssistantCoordinatorDependencies {
  provider: AIProvider;
  client(): CoreRequester;
  now?: () => number;
  createId?: () => string;
}

interface PendingProposal {
  publicProposal: AssistantProposal;
  expiresAt: number;
  consumed: boolean;
}

interface RequestState {
  id: string;
  request: AssistantTaskRequest;
  createdAt: number;
  expiresAt: number;
  abortController: AbortController;
  events: AssistantEvent[];
  nextSequence: number;
  terminal: boolean;
  proposal?: PendingProposal;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

class CoordinatorFailure extends Error {
  constructor(readonly code: AssistantFailureCode) {
    super(code);
    this.name = "CoordinatorFailure";
  }
}

const FAILURE_MESSAGES: Record<AssistantFailureCode, string> = {
  signed_out: "Sign in with ChatGPT to use Copilot.",
  unsupported_auth: "Copilot requires an existing ChatGPT sign-in.",
  timeout: "Copilot timed out. Try a smaller request.",
  cancelled: "The Copilot request was cancelled.",
  invalid_response: "Copilot returned an invalid response.",
  invalid_context: "The requested local context is unavailable.",
  conflict: "The draft changed. Refresh it and ask Copilot again.",
  unavailable: "Copilot or the local library service is unavailable.",
  unknown: "Copilot could not complete the request.",
};

const unavailableStatus = (): AssistantAuthStatus => ({
  state: "unavailable",
  auth: "unknown",
  message: "Copilot is unavailable.",
  sdkVersion: null,
});

const checkingStatus = (): AssistantAuthStatus => ({
  state: "checking",
  auth: "unknown",
  message: "Copilot is busy with the current request.",
  sdkVersion: null,
});

export class AssistantCoordinator {
  private readonly provider: AIProvider;
  private readonly client: () => CoreRequester;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly requests = new Map<string, RequestState>();
  private readonly expiredProposals = new Map<string, string>();
  private activeRequestId: string | undefined;
  private loginController: AbortController | undefined;
  private statusInProgress = false;
  private shuttingDown = false;

  constructor(dependencies: AssistantCoordinatorDependencies) {
    this.provider = dependencies.provider;
    this.client = dependencies.client;
    this.now = dependencies.now ?? Date.now;
    this.createId = dependencies.createId ?? randomUUID;
  }

  async getStatus(): Promise<AssistantAuthStatus> {
    if (this.shuttingDown) return unavailableStatus();
    if (this.activeRequestId !== undefined || this.loginController !== undefined || this.statusInProgress) {
      return checkingStatus();
    }
    this.statusInProgress = true;
    try {
      const parsed = assistantAuthStatusSchema.safeParse(await this.provider.getStatus());
      return !this.shuttingDown && parsed.success ? parsed.data : unavailableStatus();
    } catch {
      return unavailableStatus();
    } finally {
      this.statusInProgress = false;
    }
  }

  async beginLogin(): Promise<AssistantAuthStatus> {
    if (this.shuttingDown || this.loginController || this.activeRequestId !== undefined || this.statusInProgress) {
      return unavailableStatus();
    }
    const controller = new AbortController();
    this.loginController = controller;
    try {
      const parsed = assistantAuthStatusSchema.safeParse(await this.provider.beginLogin(controller.signal));
      return parsed.success ? parsed.data : unavailableStatus();
    } catch (error) {
      if (error instanceof AIProviderError && error.code === "signed_out") {
        return {
          state: "signed_out",
          auth: "none",
          message: FAILURE_MESSAGES.signed_out,
          sdkVersion: null,
        };
      }
      if (error instanceof AIProviderError && error.code === "unsupported_auth") {
        return {
          state: "unsupported_auth",
          auth: "other",
          message: FAILURE_MESSAGES.unsupported_auth,
          sdkVersion: null,
        };
      }
      return unavailableStatus();
    } finally {
      if (this.loginController === controller) this.loginController = undefined;
    }
  }

  start(request: AssistantTaskRequest): AssistantStartResult {
    if (this.shuttingDown) throw new Error("Assistant coordinator is shutting down");
    this.pruneExpiredRequests();
    if (this.activeRequestId !== undefined || this.loginController !== undefined || this.statusInProgress) {
      throw new Error("An assistant request is already active");
    }
    this.makeCapacity();
    const createdAt = this.now();
    const state: RequestState = {
      id: this.createId(),
      request,
      createdAt,
      expiresAt: createdAt + REQUEST_TTL_MS,
      abortController: new AbortController(),
      events: [],
      nextSequence: 1,
      terminal: false,
    };
    this.requests.set(state.id, state);
    this.activeRequestId = state.id;
    this.scheduleExpiry(state);
    void this.run(state);
    return assistantStartResultSchema.parse({ requestId: state.id });
  }

  poll(requestId: string, afterSequence: number): AssistantPollResult {
    const state = this.requests.get(requestId);
    if (!state || state.expiresAt <= this.now()) {
      if (state) this.expire(state);
      throw new Error("Assistant request is unavailable or expired");
    }
    const events = state.events.filter(({ sequence }) => sequence > afterSequence).slice(0, 50);
    const nextSequence = events.at(-1)?.sequence ?? afterSequence;
    return assistantPollResultSchema.parse({ events, nextSequence, terminal: state.terminal });
  }

  cancel(requestId: string): AssistantCancelResult {
    const state = this.requests.get(requestId);
    if (!state || state.expiresAt <= this.now()) {
      if (state) this.expire(state);
      return assistantCancelResultSchema.parse({ status: "not_found" });
    }
    if (state.terminal) return assistantCancelResultSchema.parse({ status: "already_terminal" });
    this.finishCancelled(state);
    return assistantCancelResultSchema.parse({ status: "cancelled" });
  }

  async confirm(requestId: string, proposalId: string): Promise<AssistantConfirmResult> {
    const state = this.requests.get(requestId);
    if (!state) {
      const expiredProposalId = this.expiredProposals.get(requestId);
      if (expiredProposalId === undefined) return this.blocked("not_found", "This proposal is unavailable.");
      if (expiredProposalId !== proposalId) {
        return this.blocked("mismatch", "This proposal does not belong to the request.");
      }
      this.expiredProposals.delete(requestId);
      return this.blocked("expired", "This proposal expired. Ask Copilot again.");
    }
    const proposal = state.proposal;
    if (!proposal || proposal.consumed) return this.blocked("not_found", "This proposal is unavailable.");
    if (proposal.publicProposal.proposalId !== proposalId) {
      return this.blocked("mismatch", "This proposal does not belong to the request.");
    }
    if (proposal.expiresAt <= this.now()) {
      proposal.consumed = true;
      return this.blocked("expired", "This proposal expired. Ask Copilot again.");
    }
    proposal.consumed = true;
    try {
      if (proposal.publicProposal.kind === "plan") {
        const createRequest = setDraftCreateRequestSchema.parse({
          title: proposal.publicProposal.title,
          plan: proposal.publicProposal.plan,
          source: proposal.publicProposal.source,
        });
        const raw = await this.client().request("create_set_draft", createRequest);
        const snapshot = this.parseCore(setDraftSnapshotSchema, raw);
        return assistantConfirmResultSchema.parse({ status: "created", snapshot });
      }

      const current = await this.fetchDraft(proposal.publicProposal.draftId);
      if (current.currentRevision !== proposal.publicProposal.expectedRevision) {
        return assistantConfirmResultSchema.parse({ status: "conflict", currentRevision: current.currentRevision });
      }
      if (!this.mutationMatchesCurrent(proposal.publicProposal.mutation, current)) {
        return this.blocked("stale", "The draft no longer matches this proposal.");
      }
      const mutationRequest = setDraftMutationRequestSchema.parse({
        draftId: proposal.publicProposal.draftId,
        expectedRevision: proposal.publicProposal.expectedRevision,
        mutation: proposal.publicProposal.mutation,
      });
      const raw = await this.client().request("mutate_set_draft", mutationRequest);
      const result = this.parseCore(setDraftMutationResultSchema, raw);
      if (result.status === "conflict") {
        return assistantConfirmResultSchema.parse(result);
      }
      if (
        result.snapshot.draftId !== proposal.publicProposal.draftId ||
        result.snapshot.currentRevision < proposal.publicProposal.expectedRevision
      ) {
        return this.blocked("invalid", "The draft update could not be validated.");
      }
      if (result.snapshot.currentRevision === proposal.publicProposal.expectedRevision) {
        return assistantConfirmResultSchema.parse({ status: "unchanged", snapshot: result.snapshot });
      }
      return assistantConfirmResultSchema.parse({ status: "updated", snapshot: result.snapshot });
    } catch (error) {
      if (error instanceof CoordinatorFailure && error.code === "invalid_response") {
        return this.blocked("invalid", "The proposal result could not be validated.");
      }
      if (error instanceof CoreServiceError && error.code === "not_found") {
        return this.blocked("stale", "The draft or track is no longer available.");
      }
      return this.blocked("unavailable", "The proposal could not be confirmed.");
    }
  }

  shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.loginController?.abort();
    this.loginController = undefined;
    if (this.activeRequestId !== undefined) {
      const active = this.requests.get(this.activeRequestId);
      if (active && !active.terminal) this.finishCancelled(active);
    }
    for (const state of this.requests.values()) {
      if (state.expiryTimer) clearTimeout(state.expiryTimer);
    }
  }

  private async run(state: RequestState): Promise<void> {
    try {
      if (state.request.kind === "search") await this.runSearch(state, state.request);
      else if (state.request.kind === "plan") await this.runPlan(state, state.request);
      else if (state.request.kind === "revise") await this.runRevision(state, state.request);
      else await this.runExplanation(state, state.request);
    } catch (error) {
      if (state.terminal) return;
      const code = this.failureCode(error, state.abortController.signal);
      if (code === "cancelled") this.finishCancelled(state);
      else this.finishFailed(state, code);
    }
  }

  private async runSearch(state: RequestState, request: Extract<AssistantTaskRequest, { kind: "search" }>) {
    this.append(state, { type: "activity", activity: "interpreting" });
    const selected = request.selectedTrackId === undefined
      ? undefined
      : await this.resolveSelectedTrack(request.selectedTrackId, 1);
    const context = selected === undefined ? { selectedTrack: null } : buildSelectedTrackContext(selected);
    const result = await this.provider.runStructured(
      { kind: "search", prompt: buildAssistantPrompt({ kind: "search", userPrompt: request.prompt, context }) },
      assistantSearchOutputSchema,
      state.abortController.signal,
      () => undefined,
    );
    if (state.terminal) return;
    this.append(state, { type: "activity", activity: "searching_local" });
    if (result.value.type === "unsupported") {
      this.append(state, {
        type: "search_result",
        result: assistantSearchResultSchema.parse({ mode: "unsupported", reason: result.value.reason }),
      });
      this.finishCompleted(state, []);
      return;
    }
    if (result.value.type === "filters") {
      if (result.value.filters.playlistId !== undefined) {
        throw new CoordinatorFailure("invalid_response");
      }
      const query = trackPageQuerySchema.parse({ ...result.value.filters, limit: ASSISTANT_EVIDENCE_TRACK_LIMIT });
      const page = this.parseCore(trackPageSchema, await this.client().request("list_tracks", query));
      if (page.items.length > ASSISTANT_EVIDENCE_TRACK_LIMIT) {
        throw new CoordinatorFailure("invalid_response");
      }
      if (state.terminal) return;
      this.append(state, {
        type: "search_result",
        result: assistantSearchResultSchema.parse({
          mode: "filters",
          summary: result.value.summary,
          filters: result.value.filters,
          response: page,
        }),
      });
      this.finishCompleted(state, page.items.map(({ id }) => id).slice(0, 20));
      return;
    }
    if (!request.selectedTrackId) throw new CoordinatorFailure("invalid_response");
    if (result.value.type === "similar") {
      const local = await this.resolveSelectedTrack(request.selectedTrackId, ASSISTANT_EVIDENCE_TRACK_LIMIT);
      if (state.terminal) return;
      this.append(state, {
        type: "search_result",
        result: assistantSearchResultSchema.parse({
          mode: "similar",
          summary: result.value.summary,
          seedTrackId: request.selectedTrackId,
          response: local,
        }),
      });
      this.finishCompleted(state, [local.seed.id, ...local.items.map(({ track }) => track.id)].slice(0, 20));
      return;
    }
    const nextRequest = recommendNextRequestSchema.parse({
      seedTrackId: request.selectedTrackId,
      intent: result.value.intent,
      limit: ASSISTANT_EVIDENCE_TRACK_LIMIT,
    });
    const local = this.parseCore(
      recommendationResponseSchema,
      await this.client().request("recommend_next_tracks", nextRequest),
    );
    if (local.seed.id !== request.selectedTrackId || local.intent !== result.value.intent) {
      throw new CoordinatorFailure("invalid_response");
    }
    if (state.terminal) return;
    this.append(state, {
      type: "search_result",
      result: assistantSearchResultSchema.parse({
        mode: "next",
        summary: result.value.summary,
        seedTrackId: request.selectedTrackId,
        intent: result.value.intent,
        response: local,
      }),
    });
    this.finishCompleted(state, [local.seed.id, ...local.items.map(({ track }) => track.id)].slice(0, 20));
  }

  private async runPlan(state: RequestState, request: Extract<AssistantTaskRequest, { kind: "plan" }>) {
    this.append(state, { type: "activity", activity: "interpreting" });
    const selected = request.selectedTrackId === undefined
      ? undefined
      : await this.resolveSelectedTrack(request.selectedTrackId, 1);
    const context = selected === undefined ? { selectedTrack: null } : buildSelectedTrackContext(selected);
    const result = await this.provider.runStructured(
      { kind: "plan", prompt: buildAssistantPrompt({ kind: "plan", userPrompt: request.prompt, context }) },
      assistantPlanOutputSchema,
      state.abortController.signal,
      () => undefined,
    );
    if (state.terminal) return;
    if (result.value.type === "unsupported") {
      this.append(state, { type: "text_snapshot", text: result.value.reason });
      this.finishCompleted(state, []);
      return;
    }
    if (result.value.useSelectedTrackAsSeed && request.selectedTrackId === undefined) {
      throw new CoordinatorFailure("invalid_response");
    }
    if (result.value.plan.candidateFilters.playlistId !== undefined) {
      throw new CoordinatorFailure("invalid_response");
    }
    this.append(state, { type: "activity", activity: "preparing_proposal" });
    const proposal = assistantProposalSchema.parse({
      kind: "plan",
      proposalId: this.createId(),
      summary: result.value.summary,
      title: result.value.title,
      plan: result.value.plan,
      source: {
        kind: "generated",
        ...(result.value.useSelectedTrackAsSeed ? { seedTrackId: request.selectedTrackId } : {}),
        maxTracks: result.value.maxTracks,
      },
      expiresAt: new Date(this.now() + REQUEST_TTL_MS).toISOString(),
    });
    this.attachProposal(state, proposal);
    this.append(state, { type: "proposal", proposal });
    this.finishCompleted(state, request.selectedTrackId ? [request.selectedTrackId] : []);
  }

  private async runRevision(state: RequestState, request: Extract<AssistantTaskRequest, { kind: "revise" }>) {
    this.append(state, { type: "activity", activity: "interpreting" });
    const snapshot = await this.fetchDraft(request.draftId);
    if (snapshot.currentRevision !== request.expectedRevision) throw new CoordinatorFailure("conflict");
    const context = buildDraftContext(snapshot);
    const knownEntryIds = new Set(snapshot.entries.map(({ id }) => id));
    const result = await this.provider.runStructured(
      { kind: "revise", prompt: buildAssistantPrompt({ kind: "revise", userPrompt: request.prompt, context }) },
      assistantRevisionOutputSchema(knownEntryIds),
      state.abortController.signal,
      () => undefined,
    );
    if (state.terminal) return;
    if (result.value.type === "unsupported") {
      this.append(state, { type: "text_snapshot", text: result.value.reason });
      this.finishCompleted(state, []);
      return;
    }
    if (!this.revisionOutputMatchesSnapshot(result.value, snapshot)) {
      throw new CoordinatorFailure("invalid_response");
    }
    const { mutation, evidenceTrackIds } = await this.normalizeRevision(result.value, snapshot);
    if (state.terminal) return;
    this.append(state, { type: "activity", activity: "preparing_proposal" });
    const proposal = assistantProposalSchema.parse({
      kind: "revision",
      proposalId: this.createId(),
      summary: this.revisionSummary(result.value),
      draftId: request.draftId,
      expectedRevision: request.expectedRevision,
      mutation,
      evidenceTrackIds,
      expiresAt: new Date(this.now() + REQUEST_TTL_MS).toISOString(),
    });
    this.attachProposal(state, proposal);
    this.append(state, { type: "proposal", proposal });
    this.finishCompleted(state, evidenceTrackIds);
  }

  private async runExplanation(state: RequestState, request: Extract<AssistantTaskRequest, { kind: "explain" }>) {
    this.append(state, { type: "activity", activity: "explaining" });
    let context: unknown;
    if (request.context.kind === "selected_track") {
      context = buildDiscoveryContext(
        await this.resolveSelectedTrack(request.context.selectedTrackId, ASSISTANT_EVIDENCE_TRACK_LIMIT),
      );
    } else if (request.context.kind === "next") {
      const nextRequest = recommendNextRequestSchema.parse({
        seedTrackId: request.context.selectedTrackId,
        intent: request.context.intent,
        limit: ASSISTANT_EVIDENCE_TRACK_LIMIT,
      });
      const local = this.parseCore(
        recommendationResponseSchema,
        await this.client().request("recommend_next_tracks", nextRequest),
      );
      if (local.seed.id !== request.context.selectedTrackId || local.intent !== request.context.intent) {
        throw new CoordinatorFailure("invalid_response");
      }
      context = buildDiscoveryContext(local);
    } else {
      const snapshot = await this.fetchDraft(request.context.draftId);
      if (snapshot.currentRevision !== request.context.expectedRevision) throw new CoordinatorFailure("conflict");
      const inspectRequest = setDraftInspectRequestSchema.parse({
        kind: "draft",
        draftId: request.context.draftId,
        revision: request.context.expectedRevision,
      });
      const localInspection = this.parseCore(
        setDraftInspectResultSchema,
        await this.client().request("analyze_set", inspectRequest),
      );
      context = buildDraftExplanationContext(snapshot, localInspection);
    }
    const onEvent = (event: { type: "text_snapshot"; text: string }) => {
      if (state.terminal || !validateGroundedExplanationSnapshot(event.text, context)) return;
      const previous = state.events.at(-1);
      if (previous?.type === "text_snapshot" && previous.text === event.text) return;
      this.append(state, { type: "text_snapshot", text: event.text });
    };
    const result = await this.provider.runText(
      { kind: "explain", prompt: buildAssistantPrompt({ kind: "explain", userPrompt: request.prompt, context }) },
      state.abortController.signal,
      onEvent,
    );
    if (state.terminal) return;
    this.append(state, { type: "activity", activity: "validating" });
    let grounded: ReturnType<typeof validateGroundedExplanation>;
    try {
      grounded = validateGroundedExplanation(result.text, context);
    } catch {
      throw new CoordinatorFailure("invalid_response");
    }
    const previous = state.events.at(-2);
    if (previous?.type !== "text_snapshot" || previous.text !== grounded.text) {
      this.append(state, { type: "text_snapshot", text: grounded.text });
    }
    this.finishCompleted(state, grounded.evidenceTrackIds);
  }

  private async resolveSelectedTrack(selectedTrackId: string, limit: number) {
    const request = findSimilarRequestSchema.parse({ seedTrackId: selectedTrackId, limit });
    const response = this.parseCore(
      similarityResponseSchema,
      await this.client().request("find_similar_tracks", request),
    );
    if (response.seed.id !== selectedTrackId) throw new CoordinatorFailure("invalid_response");
    return response;
  }

  private async fetchDraft(draftId: string): Promise<SetDraftSnapshot> {
    const snapshot = this.parseCore(
      setDraftSnapshotSchema,
      await this.client().request("get_set_draft", { draftId }),
    );
    if (snapshot.draftId !== draftId || snapshot.viewingVersion !== null) {
      throw new CoordinatorFailure("invalid_response");
    }
    return snapshot;
  }

  private async normalizeRevision(output: Exclude<AssistantRevisionOutput, { type: "unsupported" }>, snapshot: SetDraftSnapshot) {
    const affectedEntry = "entryId" in output
      ? snapshot.entries.find(({ id }) => id === output.entryId)
      : undefined;
    if (output.type !== "replace_with_best") {
      const mutation = setDraftMutationRequestSchema.shape.mutation.parse(output) as SetDraftMutationRequest["mutation"];
      const evidenceTrackIds = output.type === "optimize"
        ? snapshot.entries.map(({ trackId }) => trackId).slice(0, 20)
        : affectedEntry ? [affectedEntry.trackId] : [];
      return { mutation, evidenceTrackIds };
    }
    const replacementRequest = setDraftReplacementRequestSchema.parse({
      draftId: snapshot.draftId,
      entryId: output.entryId,
      revision: snapshot.currentRevision,
    });
    const replacements = this.parseCore(
      setDraftReplacementResultSchema,
      await this.client().request("find_set_replacements", replacementRequest),
    );
    const replacement = replacements.items[0];
    if (!replacement || !affectedEntry) throw new CoordinatorFailure("invalid_response");
    const unavailableTrackIds = new Set([
      ...snapshot.entries.map(({ trackId }) => trackId),
      ...snapshot.bans,
    ]);
    if (unavailableTrackIds.has(replacement.track.id)) {
      throw new CoordinatorFailure("invalid_response");
    }
    return {
      mutation: {
        type: "replace_entry" as const,
        entryId: output.entryId,
        replacementTrackId: replacement.track.id,
      },
      evidenceTrackIds: [...new Set([affectedEntry.trackId, replacement.track.id])],
    };
  }

  private revisionOutputMatchesSnapshot(
    output: Exclude<AssistantRevisionOutput, { type: "unsupported" }>,
    snapshot: SetDraftSnapshot,
  ): boolean {
    if (
      output.type === "set_plan" &&
      output.plan.candidateFilters.playlistId !== undefined &&
      output.plan.candidateFilters.playlistId !== snapshot.plan.candidateFilters.playlistId
    ) {
      return false;
    }
    if (!("entryId" in output)) return true;
    const entryIndex = snapshot.entries.findIndex(({ id }) => id === output.entryId);
    if (entryIndex < 0) return false;
    return output.type !== "move_entry" || output.toIndex < snapshot.entries.length;
  }

  private mutationMatchesCurrent(mutation: SetDraftMutationRequest["mutation"], snapshot: SetDraftSnapshot): boolean {
    if (!("entryId" in mutation)) return true;
    const entryIndex = snapshot.entries.findIndex(({ id }) => id === mutation.entryId);
    if (entryIndex < 0) return false;
    return mutation.type !== "move_entry" || mutation.toIndex < snapshot.entries.length;
  }

  private revisionSummary(output: Exclude<AssistantRevisionOutput, { type: "unsupported" }>): string {
    if (output.type === "rename") return `Rename the draft to “${output.title}”.`;
    if (output.type === "replace_with_best") return "Replace the selected entry with the best current local candidate.";
    if (output.type === "set_plan") return "Replace the draft plan with the proposed plan.";
    if (output.type === "optimize") return "Optimize the draft using the current deterministic local ranking.";
    return "Apply the requested change to the selected draft entry.";
  }

  private parseCore<Output>(schema: { safeParse(value: unknown): { success: true; data: Output } | { success: false } }, value: unknown): Output {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new CoordinatorFailure("invalid_response");
    return parsed.data;
  }

  private attachProposal(state: RequestState, publicProposal: AssistantProposal): void {
    const expiresAt = this.now() + REQUEST_TTL_MS;
    state.proposal = { publicProposal, expiresAt, consumed: false };
    state.expiresAt = Math.max(state.expiresAt, expiresAt);
    this.scheduleExpiry(state);
  }

  private append(state: RequestState, event: AssistantEventInput): void {
    if (state.terminal) return;
    const parsed = assistantEventSchema.parse({ ...event, sequence: state.nextSequence });
    state.nextSequence += 1;
    state.events.push(parsed);
    while (state.events.length > MAX_EVENTS_PER_REQUEST) state.events.shift();
  }

  private finishCompleted(state: RequestState, evidenceTrackIds: string[]): void {
    if (state.terminal) return;
    this.append(state, { type: "completed", evidenceTrackIds: [...new Set(evidenceTrackIds)].slice(0, 20) });
    this.markTerminal(state);
  }

  private finishFailed(state: RequestState, code: AssistantFailureCode): void {
    if (state.terminal) return;
    this.append(state, { type: "failed", error: { code, message: FAILURE_MESSAGES[code] } });
    this.markTerminal(state);
  }

  private finishCancelled(state: RequestState): void {
    if (state.terminal) return;
    state.abortController.abort();
    this.append(state, { type: "cancelled" });
    this.markTerminal(state);
  }

  private markTerminal(state: RequestState): void {
    state.terminal = true;
    if (this.activeRequestId === state.id) this.activeRequestId = undefined;
  }

  private failureCode(error: unknown, signal: AbortSignal): AssistantFailureCode {
    if (signal.aborted) return "cancelled";
    if (error instanceof CoordinatorFailure) return error.code;
    if (error instanceof AIProviderError) return error.code;
    if (error instanceof CoreServiceError) {
      return error.code === "not_found" ? "invalid_context" : "unavailable";
    }
    return "unknown";
  }

  private blocked(
    code: Extract<Extract<AssistantConfirmResult, { status: "blocked" }>["code"], string>,
    message: string,
  ): AssistantConfirmResult {
    return assistantConfirmResultSchema.parse({ status: "blocked", code, message });
  }

  private makeCapacity(): void {
    if (this.requests.size < MAX_REQUESTS) return;
    for (const state of this.requests.values()) {
      if (!state.terminal) continue;
      if (state.expiryTimer) clearTimeout(state.expiryTimer);
      this.requests.delete(state.id);
      if (this.requests.size < MAX_REQUESTS) return;
    }
    throw new Error("Assistant request capacity is unavailable");
  }

  private pruneExpiredRequests(): void {
    for (const state of this.requests.values()) {
      if (state.expiresAt <= this.now()) this.expire(state);
    }
  }

  private scheduleExpiry(state: RequestState): void {
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    const delay = Math.max(0, state.expiresAt - this.now());
    state.expiryTimer = setTimeout(() => this.expire(state), delay);
    state.expiryTimer.unref?.();
  }

  private expire(state: RequestState): void {
    if (this.requests.get(state.id) !== state) return;
    state.abortController.abort();
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    if (state.proposal && !state.proposal.consumed) {
      this.expiredProposals.set(state.id, state.proposal.publicProposal.proposalId);
      while (this.expiredProposals.size > MAX_REQUESTS) {
        const oldest = this.expiredProposals.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.expiredProposals.delete(oldest);
      }
    }
    this.requests.delete(state.id);
    if (this.activeRequestId === state.id) this.activeRequestId = undefined;
  }
}
