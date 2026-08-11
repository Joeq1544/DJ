import { isAbsolute, join, resolve } from "node:path";

export interface RuntimeLayoutOptions {
  isPackaged: boolean;
  resourcesPath: string;
  compiledDirectory: string;
}

export interface RuntimeLayout {
  repositoryRoot: string;
  packagedResourcesPath: string | undefined;
  codexSdkPackageDirectory: string | undefined;
}

export function resolveRuntimeLayout(options: RuntimeLayoutOptions): RuntimeLayout {
  if (!options.isPackaged) {
    return {
      repositoryRoot: resolve(options.compiledDirectory, "../../../.."),
      packagedResourcesPath: undefined,
      codexSdkPackageDirectory: undefined,
    };
  }
  if (!isAbsolute(options.resourcesPath) || resolve(options.resourcesPath) !== options.resourcesPath) {
    throw new Error("Packaged resources path must be absolute");
  }
  return {
    repositoryRoot: options.resourcesPath,
    packagedResourcesPath: options.resourcesPath,
    codexSdkPackageDirectory: join(
      options.resourcesPath,
      "app",
      "node_modules",
      "@openai",
      "codex-sdk",
    ),
  };
}
