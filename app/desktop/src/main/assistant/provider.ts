import type { z } from "zod";
import type { AssistantAuthStatus, AssistantTaskRequest } from "../../shared/contracts";

export const CODEX_SDK_VERSION = "0.147.0" as const;
export const PROVIDER_TEXT_LIMIT = 8_000;

export type AIProviderTaskKind = AssistantTaskRequest["kind"];

export interface AIProviderTask {
  kind: AIProviderTaskKind;
  prompt: string;
  threadId?: string;
}

export interface AIProviderEvent {
  type: "text_snapshot";
  text: string;
}

export type AIProviderEventHandler = (event: AIProviderEvent) => void;

export interface AIProviderResult {
  text: string;
  threadId?: string;
}

export interface AIProviderStructuredResult<Output> extends AIProviderResult {
  value: Output;
}

export interface AIProviderOutputSchema<Output> {
  jsonSchema: Readonly<Record<string, unknown>>;
  zodSchema: z.ZodType<Output>;
  validateKnownIds?: (value: Output) => boolean;
}

export type AIProviderErrorCode =
  | "signed_out"
  | "unsupported_auth"
  | "timeout"
  | "cancelled"
  | "invalid_response"
  | "unavailable"
  | "unknown";

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;

  constructor(code: AIProviderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AIProviderError";
    this.code = code;
  }
}

export interface AIProvider {
  getStatus(): Promise<AssistantAuthStatus>;
  beginLogin(signal: AbortSignal): Promise<AssistantAuthStatus>;
  runStructured<Output>(
    task: AIProviderTask,
    outputSchema: AIProviderOutputSchema<Output>,
    signal: AbortSignal,
    onEvent: AIProviderEventHandler,
  ): Promise<AIProviderStructuredResult<Output>>;
  runText(
    task: AIProviderTask,
    signal: AbortSignal,
    onEvent: AIProviderEventHandler,
  ): Promise<AIProviderResult>;
}
