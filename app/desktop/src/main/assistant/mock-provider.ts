import { assistantAuthStatusSchema, type AssistantAuthStatus } from "../../shared/contracts";
import {
  AIProviderError,
  PROVIDER_TEXT_LIMIT,
  type AIProvider,
  type AIProviderEventHandler,
  type AIProviderOutputSchema,
  type AIProviderResult,
  type AIProviderStructuredResult,
  type AIProviderTask,
  type AIProviderTaskKind,
} from "./provider";

const READY_STATUS: AssistantAuthStatus = {
  state: "ready",
  auth: "chatgpt",
  message: "Codex is ready.",
  sdkVersion: "0.147.0",
};

export type MockAIProviderResponse =
  | { kind: "structured"; value: unknown }
  | { kind: "text"; text: string }
  | { kind: "wait_for_cancellation" };

export interface MockAIProviderScript {
  kind: AIProviderTaskKind;
  promptIncludes: string;
  response: MockAIProviderResponse;
  threadId?: string;
}

export interface MockAIProviderOptions {
  status?: AssistantAuthStatus;
  loginStatus?: AssistantAuthStatus;
  scripts?: readonly MockAIProviderScript[];
}

interface MatchedResponse {
  response: MockAIProviderResponse;
  threadId?: string;
}

function validStatus(status: AssistantAuthStatus): AssistantAuthStatus {
  const parsed = assistantAuthStatusSchema.safeParse(status);
  if (!parsed.success) throw new TypeError("Invalid mock provider status");
  return parsed.data;
}

function isValidThreadId(value: string): boolean {
  return value.length >= 1
    && value.length <= 128
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function knownTrackId(prompt: string): string | undefined {
  const match = /"(?:trackId|id)"\s*:\s*"([A-Za-z0-9._:-]{1,128})"/u.exec(prompt);
  return match?.[1];
}

function defaultResponse(task: AIProviderTask): MockAIProviderResponse {
  if (task.prompt.toLowerCase().includes("wait for cancellation")) {
    return { kind: "wait_for_cancellation" };
  }
  if (task.kind === "search") {
    if (task.prompt.includes("Find warm house tracks")) {
      return {
        kind: "structured",
        value: { type: "filters", summary: "House tracks matching your request.", filters: { genre: "House" } },
      };
    }
    if (task.prompt.includes("Find tracks similar to this")) {
      return {
        kind: "structured",
        value: { type: "similar", summary: "Tracks similar to the selected track.", useSelectedTrack: true },
      };
    }
    if (task.prompt.includes("What should I play next to build energy?")) {
      return {
        kind: "structured",
        value: { type: "next", summary: "Build energy from the selected track.", useSelectedTrack: true, intent: "build" },
      };
    }
    return { kind: "structured", value: { type: "unsupported", reason: "This search request is not supported." } };
  }
  if (task.kind === "plan") {
    if (task.prompt.includes("Plan a smooth five-track set")) {
      return {
        kind: "structured",
        value: {
          type: "create_draft",
          summary: "A smooth five-track set plan.",
          title: "Smooth Five-Track Set",
          plan: { intent: "smooth", targetDurationMs: null, maxArtistRepeats: null, candidateFilters: {} },
          maxTracks: 5,
          useSelectedTrackAsSeed: false,
        },
      };
    }
    return { kind: "structured", value: { type: "unsupported", reason: "This set-plan request is not supported." } };
  }
  if (task.kind === "revise") {
    if (task.prompt.includes("Rename this set to Sunset Session")) {
      return { kind: "structured", value: { type: "rename", title: "Sunset Session" } };
    }
    return { kind: "structured", value: { type: "unsupported", reason: "This revision request is not supported." } };
  }
  const trackId = knownTrackId(task.prompt);
  const citation = trackId === undefined ? "" : ` [track:${trackId}]`;
  return {
    kind: "text",
    text: `The supplied local metadata supports this explanation.${citation}`,
  };
}

export class MockAIProvider implements AIProvider {
  private currentStatus: AssistantAuthStatus;
  private readonly loginStatus: AssistantAuthStatus;
  private readonly scripts: readonly MockAIProviderScript[];
  private nextThreadSequence = 1;

  constructor(options: MockAIProviderOptions = {}) {
    this.currentStatus = validStatus(options.status ?? READY_STATUS);
    this.loginStatus = validStatus(options.loginStatus ?? READY_STATUS);
    this.scripts = options.scripts ?? [];
  }

  async getStatus(): Promise<AssistantAuthStatus> {
    return { ...this.currentStatus };
  }

  async beginLogin(signal: AbortSignal): Promise<AssistantAuthStatus> {
    this.requireNotAborted(signal);
    this.currentStatus = this.loginStatus;
    return { ...this.currentStatus };
  }

  async runStructured<Output>(
    task: AIProviderTask,
    outputSchema: AIProviderOutputSchema<Output>,
    signal: AbortSignal,
    _onEvent: AIProviderEventHandler,
  ): Promise<AIProviderStructuredResult<Output>> {
    this.requireNotAborted(signal);
    const matched = this.match(task);
    if (matched.response.kind === "wait_for_cancellation") return this.waitForCancellation(signal);
    if (matched.response.kind !== "structured") throw this.invalidResponse();
    const text = JSON.stringify(matched.response.value);
    if (text.length > PROVIDER_TEXT_LIMIT) throw this.invalidResponse();
    const parsed = outputSchema.zodSchema.safeParse(matched.response.value);
    if (!parsed.success) throw this.invalidResponse();
    if (outputSchema.validateKnownIds !== undefined) {
      try {
        if (!outputSchema.validateKnownIds(parsed.data)) throw this.invalidResponse();
      } catch (error) {
        if (error instanceof AIProviderError) throw error;
        throw this.invalidResponse();
      }
    }
    this.requireNotAborted(signal);
    return { text, value: parsed.data, threadId: this.threadId(task, matched.threadId) };
  }

  async runText(
    task: AIProviderTask,
    signal: AbortSignal,
    onEvent: AIProviderEventHandler,
  ): Promise<AIProviderResult> {
    this.requireNotAborted(signal);
    const matched = this.match(task);
    if (matched.response.kind === "wait_for_cancellation") return this.waitForCancellation(signal);
    if (
      matched.response.kind !== "text"
      || matched.response.text.trim().length === 0
      || matched.response.text.length > PROVIDER_TEXT_LIMIT
    ) {
      throw this.invalidResponse();
    }
    this.requireNotAborted(signal);
    onEvent({ type: "text_snapshot", text: matched.response.text });
    this.requireNotAborted(signal);
    return { text: matched.response.text, threadId: this.threadId(task, matched.threadId) };
  }

  private match(task: AIProviderTask): MatchedResponse {
    const scripted = this.scripts.find((candidate) => (
      candidate.kind === task.kind && task.prompt.includes(candidate.promptIncludes)
    ));
    if (scripted === undefined) return { response: defaultResponse(task) };
    return {
      response: scripted.response,
      ...(scripted.threadId === undefined ? {} : { threadId: scripted.threadId }),
    };
  }

  private threadId(task: AIProviderTask, scriptedThreadId?: string): string {
    const threadId = task.threadId ?? scriptedThreadId ?? `mock-thread-${this.nextThreadSequence++}`;
    if (!isValidThreadId(threadId)) throw this.invalidResponse();
    return threadId;
  }

  private requireNotAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new AIProviderError("cancelled", "The mock provider request was cancelled.");
  }

  private waitForCancellation<Result>(signal: AbortSignal): Promise<Result> {
    this.requireNotAborted(signal);
    return new Promise<Result>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(new AIProviderError("cancelled", "The mock provider request was cancelled."));
      }, { once: true });
    });
  }

  private invalidResponse(): AIProviderError {
    return new AIProviderError("invalid_response", "Mock provider response is invalid.");
  }
}
