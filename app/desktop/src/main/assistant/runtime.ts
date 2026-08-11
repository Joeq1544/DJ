import type { CoreRequest } from "../../shared/contracts";
import { AssistantCoordinator } from "./coordinator";
import type { AIProvider } from "./provider";

interface CoreRequester {
  request(command: CoreRequest["command"], payload: unknown): Promise<unknown>;
}

export interface AssistantRuntimeOptions {
  environment?: NodeJS.ProcessEnv;
  workingDirectory: string;
  client(): CoreRequester;
  loadCodexProvider?: (workingDirectory: string) => Promise<AIProvider>;
  loadMockProvider?: () => Promise<AIProvider>;
}

export interface AssistantRuntime {
  coordinator: AssistantCoordinator;
}

async function defaultCodexProvider(workingDirectory: string): Promise<AIProvider> {
  const { CodexProvider } = await import("./codex-provider");
  return new CodexProvider({ workingDirectory });
}

async function defaultMockProvider(): Promise<AIProvider> {
  const { MockAIProvider } = await import("./mock-provider");
  return new MockAIProvider();
}

export async function createAssistantRuntime(options: AssistantRuntimeOptions): Promise<AssistantRuntime> {
  const environment = options.environment ?? process.env;
  const useMock = environment.DJ_COPILOT_TEST_MODE === "1"
    && environment.DJ_COPILOT_ASSISTANT_PROVIDER === "mock";
  const provider = useMock
    ? await (options.loadMockProvider ?? defaultMockProvider)()
    : await (options.loadCodexProvider ?? defaultCodexProvider)(options.workingDirectory);
  return {
    coordinator: new AssistantCoordinator({ provider, client: options.client }),
  };
}
