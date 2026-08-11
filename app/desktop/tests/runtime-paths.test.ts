import { describe, expect, it } from "vitest";
import { resolveRuntimeLayout } from "../src/main/runtime-paths";

describe("main runtime layout", () => {
  it("pins every packaged service to the production Resources tree", () => {
    expect(resolveRuntimeLayout({
      isPackaged: true,
      resourcesPath: "/Applications/DJ Copilot.app/Contents/Resources",
      compiledDirectory: "/tmp/untrusted-cwd/app/desktop/dist/main",
    })).toEqual({
      repositoryRoot: "/Applications/DJ Copilot.app/Contents/Resources",
      packagedResourcesPath: "/Applications/DJ Copilot.app/Contents/Resources",
      codexSdkPackageDirectory: "/Applications/DJ Copilot.app/Contents/Resources/app/node_modules/@openai/codex-sdk",
    });
  });

  it("retains repository-relative development resolution without claiming packaged paths", () => {
    expect(resolveRuntimeLayout({
      isPackaged: false,
      resourcesPath: "/must/not/be/used",
      compiledDirectory: "/workspace/DJ/app/desktop/dist/main",
    })).toEqual({
      repositoryRoot: "/workspace/DJ",
      packagedResourcesPath: undefined,
      codexSdkPackageDirectory: undefined,
    });
  });

  it("rejects a relative packaged resources path instead of resolving through cwd", () => {
    expect(() => resolveRuntimeLayout({
      isPackaged: true,
      resourcesPath: "relative/Resources",
      compiledDirectory: "/workspace/DJ/app/desktop/dist/main",
    })).toThrow("Packaged resources path must be absolute");
  });
});
