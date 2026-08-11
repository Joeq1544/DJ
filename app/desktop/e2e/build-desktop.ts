import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function buildDesktop(desktopDirectory: string): Promise<void> {
  await execFileAsync(process.execPath, ["scripts/build-main.mjs"], {
    cwd: desktopDirectory,
  });
  await execFileAsync(join(desktopDirectory, "node_modules", ".bin", "vite"), ["build"], {
    cwd: desktopDirectory,
  });
}
