import { describe, expect, it } from "vitest";
import { createAssistantRuntime } from "../src/main/assistant/runtime";
import type { AIProvider } from "../src/main/assistant/provider";

function provider(message: string, calls: string[]): AIProvider {
  return {
    getStatus: async () => {
      calls.push("status");
      return { state: "ready", auth: "chatgpt", message, sdkVersion: "0.147.0" };
    },
    beginLogin: async () => ({ state: "ready", auth: "chatgpt", message, sdkVersion: "0.147.0" }),
    runStructured: async () => { throw new Error("not used"); },
    runText: async () => { throw new Error("not used"); },
  };
}

describe("assistant runtime selection", () => {
  it("uses production by default without calling a provider or reading API-key environment", async () => {
    const codexCalls: string[] = [];
    const mockCalls: string[] = [];
    const environment = new Proxy({ DJ_COPILOT_ASSISTANT_PROVIDER: "mock" } as NodeJS.ProcessEnv, {
      get(target, property, receiver) {
        if (property === "OPENAI_API_KEY") throw new Error("API-key environment must not be read");
        return Reflect.get(target, property, receiver);
      },
    });
    const runtime = await createAssistantRuntime({
      environment,
      workingDirectory: "/tmp/dj-copilot-assistant",
      client: () => ({ request: async () => ({}) }),
      loadCodexProvider: async () => provider("Production ready.", codexCalls),
      loadMockProvider: async () => provider("Mock ready.", mockCalls),
    });

    expect(codexCalls).toEqual([]);
    expect(mockCalls).toEqual([]);
    await expect(runtime.coordinator.getStatus()).resolves.toMatchObject({ message: "Production ready." });
    expect(codexCalls).toEqual(["status"]);
    expect(mockCalls).toEqual([]);
  });

  it("allows mock only when both test mode and the explicit provider selector are set", async () => {
    const codexCalls: string[] = [];
    const mockCalls: string[] = [];
    const runtime = await createAssistantRuntime({
      environment: { DJ_COPILOT_TEST_MODE: "1", DJ_COPILOT_ASSISTANT_PROVIDER: "mock" },
      workingDirectory: "/tmp/dj-copilot-assistant",
      client: () => ({ request: async () => ({}) }),
      loadCodexProvider: async () => provider("Production ready.", codexCalls),
      loadMockProvider: async () => provider("Mock ready.", mockCalls),
    });

    expect(codexCalls).toEqual([]);
    expect(mockCalls).toEqual([]);
    await expect(runtime.coordinator.getStatus()).resolves.toMatchObject({ message: "Mock ready." });
    expect(codexCalls).toEqual([]);
    expect(mockCalls).toEqual(["status"]);
  });
});
