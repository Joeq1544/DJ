import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findPackagedCodexSdkDirectory,
  PackagedCodexAuthRunner,
  type AuthCommandInvocation,
  type AuthCommandResult,
} from "../src/main/assistant/auth-runner";

const commandResult = (
  stderr: string,
  code = 0,
  stdout = "",
): AuthCommandResult => ({ code, signal: null, stdout, stderr });

describe("PackagedCodexAuthRunner", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function packageFixture(helperVersion = "0.147.0"): Promise<{ sdkDirectory: string; helperPath: string }> {
    const root = await mkdtemp(join(tmpdir(), "dj-assistant-auth-"));
    directories.push(root);
    const packageScope = join(root, "node_modules", "@openai");
    const sdkDirectory = join(packageScope, "codex-sdk");
    const helperDirectory = join(packageScope, "codex");
    const helperPath = join(helperDirectory, "bin", "codex.js");
    await mkdir(join(helperDirectory, "bin"), { recursive: true });
    await mkdir(sdkDirectory, { recursive: true });
    await writeFile(join(sdkDirectory, "package.json"), JSON.stringify({
      name: "@openai/codex-sdk",
      version: "0.147.0",
    }));
    await writeFile(join(helperDirectory, "package.json"), JSON.stringify({
      name: "@openai/codex",
      version: helperVersion,
      bin: { codex: "bin/codex.js" },
    }));
    await writeFile(helperPath, "#!/usr/bin/env node\n");
    return { sdkDirectory, helperPath: await realpath(helperPath) };
  }

  it.each([
    {
      name: "existing ChatGPT login",
      result: commandResult("Logged in using ChatGPT\n"),
      expected: { state: "ready", auth: "chatgpt", message: "Codex is ready.", sdkVersion: "0.147.0" },
    },
    {
      name: "signed out",
      result: commandResult("Not logged in\n", 1),
      expected: { state: "signed_out", auth: "none", message: "Sign in with ChatGPT to use Copilot.", sdkVersion: "0.147.0" },
    },
    {
      name: "API-key authentication",
      result: commandResult("Logged in using an API key - redacted\n"),
      expected: { state: "unsupported_auth", auth: "other", message: "Copilot requires Sign in with ChatGPT.", sdkVersion: "0.147.0" },
    },
    {
      name: "access-token authentication",
      result: commandResult("Logged in using an access token\n"),
      expected: { state: "unsupported_auth", auth: "other", message: "Copilot requires Sign in with ChatGPT.", sdkVersion: "0.147.0" },
    },
  ])("classifies $name into one sanitized status", async ({ result, expected }) => {
    const fixture = await packageFixture();
    const runner = new PackagedCodexAuthRunner({
      sdkPackageDirectory: fixture.sdkDirectory,
      commandRunner: async (invocation) => invocation.args[0] === "--version"
        ? commandResult("", 0, "codex-cli 0.147.0\n")
        : result,
    });

    await expect(runner.getStatus()).resolves.toEqual(expected);
  });

  it("rejects extra or credential-shaped helper output without returning it", async () => {
    const fixture = await packageFixture();
    const runner = new PackagedCodexAuthRunner({
      sdkPackageDirectory: fixture.sdkDirectory,
      commandRunner: async (invocation) => invocation.args[0] === "--version"
        ? commandResult("", 0, "codex-cli 0.147.0\n")
        : commandResult("unexpected-sensitive-output\nLogged in using ChatGPT\n"),
    });

    const status = await runner.getStatus();

    expect(status).toEqual({
      state: "unavailable",
      auth: "unknown",
      message: "Codex authentication status is unavailable.",
      sdkVersion: null,
    });
    expect(JSON.stringify(status)).not.toContain("unexpected-sensitive-output");
  });

  it("allows only the known PATH-alias warning before exact version and ChatGPT status lines", async () => {
    const fixture = await packageFixture();
    const warning = "WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)\n";
    const runner = new PackagedCodexAuthRunner({
      sdkPackageDirectory: fixture.sdkDirectory,
      commandRunner: async (invocation) => invocation.args[0] === "--version"
        ? commandResult(warning, 0, "codex-cli 0.147.0\n")
        : commandResult(`${warning}Logged in using ChatGPT\n`),
    });

    await expect(runner.getStatus()).resolves.toEqual({
      state: "ready",
      auth: "chatgpt",
      message: "Codex is ready.",
      sdkVersion: "0.147.0",
    });

    const credentialShapedWarning = new PackagedCodexAuthRunner({
      sdkPackageDirectory: fixture.sdkDirectory,
      commandRunner: async (invocation) => invocation.args[0] === "--version"
        ? commandResult(warning, 0, "codex-cli 0.147.0\n")
        : commandResult(`${warning.trim()} sk-fake-credential\nLogged in using ChatGPT\n`),
    });
    await expect(credentialShapedWarning.getStatus()).resolves.toMatchObject({ state: "unavailable" });
  });

  it("uses only the matching packaged helper and removes auth overrides before reading environment values", async () => {
    const fixture = await packageFixture();
    const invocations: AuthCommandInvocation[] = [];
    const source = new Proxy({
      PATH: "/safe/bin",
      SAFE_VALUE: "preserved",
      OPENAI_API_KEY: "must-not-be-read",
      CODEX_API_KEY: "must-not-be-read",
      CODEX_ACCESS_TOKEN: "must-not-be-read",
      OPENAI_BASE_URL: "must-not-be-read",
      OPENAI_API_BASE: "must-not-be-read",
      AZURE_OPENAI_API_KEY: "must-not-be-read",
      AZURE_OPENAI_ENDPOINT: "must-not-be-read",
    }, {
      get(target, property, receiver) {
        if (typeof property === "string" && property !== "PATH" && property !== "SAFE_VALUE") {
          throw new Error(`forbidden environment read: ${property}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const runner = new PackagedCodexAuthRunner({
      sdkPackageDirectory: fixture.sdkDirectory,
      environment: source,
      commandRunner: async (invocation) => {
        invocations.push(invocation);
        return invocation.args[0] === "--version"
          ? commandResult("", 0, "codex-cli 0.147.0\n")
          : commandResult("Logged in using ChatGPT\n");
      },
    });

    await expect(runner.getStatus()).resolves.toMatchObject({ state: "ready" });
    expect(invocations.map(({ executable, args }) => ({ executable, args }))).toEqual([
      { executable: fixture.helperPath, args: ["--version"] },
      { executable: fixture.helperPath, args: ["login", "status"] },
    ]);
    expect(invocations[0]!.environment).toEqual({ PATH: "/safe/bin", SAFE_VALUE: "preserved" });
  });

  it("runs only interactive ChatGPT login and confirms the resulting exact status", async () => {
    const fixture = await packageFixture();
    const calls: string[][] = [];
    const runner = new PackagedCodexAuthRunner({
      sdkPackageDirectory: fixture.sdkDirectory,
      commandRunner: async ({ args }) => {
        calls.push([...args]);
        if (args[0] === "--version") return commandResult("", 0, "codex-cli 0.147.0\n");
        if (args.length === 1 && args[0] === "login") return commandResult("Browser login complete\n");
        return commandResult("Logged in using ChatGPT\n");
      },
    });

    await expect(runner.beginLogin(new AbortController().signal)).resolves.toEqual({
      state: "ready",
      auth: "chatgpt",
      message: "Codex is ready.",
      sdkVersion: "0.147.0",
    });
    expect(calls).toEqual([["--version"], ["login"], ["--version"], ["login", "status"]]);
  });

  it("fails closed when the packaged helper version does not match the SDK", async () => {
    const fixture = await packageFixture("0.146.0");
    let invoked = false;
    const runner = new PackagedCodexAuthRunner({
      sdkPackageDirectory: fixture.sdkDirectory,
      commandRunner: async () => {
        invoked = true;
        return commandResult("Logged in using ChatGPT\n");
      },
    });

    await expect(runner.getStatus()).resolves.toEqual({
      state: "unavailable",
      auth: "unknown",
      message: "Codex authentication status is unavailable.",
      sdkVersion: null,
    });
    expect(invoked).toBe(false);
  });

  it("finds the M7 external SDK only at the fixed Resources/app/node_modules layout", async () => {
    const resources = await mkdtemp(join(tmpdir(), "dj-assistant-resources-"));
    directories.push(resources);
    const sdkDirectory = join(resources, "app", "node_modules", "@openai", "codex-sdk");
    await mkdir(sdkDirectory, { recursive: true });
    await writeFile(join(sdkDirectory, "package.json"), JSON.stringify({
      name: "@openai/codex-sdk",
      version: "0.147.0",
    }));

    await expect(findPackagedCodexSdkDirectory([resources])).resolves.toBe(sdkDirectory);
  });
});
