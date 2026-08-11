import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

const desktopDirectory = process.cwd();
const repositoryRoot = resolve(desktopDirectory, "../..");
const executable = join(repositoryRoot, "out/DJ Copilot-darwin-arm64/DJ Copilot.app/Contents/MacOS/DJ Copilot");

test.skip(process.env.DJ_COPILOT_REAL_SMOKE !== "1", "Explicit existing-auth packaged smoke only");

function environment(): Record<string, string> {
  const keep = ["HOME", "CODEX_HOME", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"];
  const values = Object.fromEntries(keep.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
  return { ...values, PATH: "/usr/bin:/bin", DJ_COPILOT_TEST_MODE: "1" };
}

test("runs real existing-ChatGPT Codex requests from the packaged arm64 app", async () => {
  test.setTimeout(300_000);
  await expect(access(executable)).resolves.toBeUndefined();
  const root = await mkdtemp(join(tmpdir(), "DJ Copilot real smoke with spaces "));
  const userDataPath = join(root, "user data with spaces");
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${userDataPath}`],
      env: environment(),
    });
    const page = await application.firstWindow();
    const panel = page.getByRole("region", { name: "Copilot" });
    await panel.getByRole("button", { name: "Refresh Copilot status" }).click();
    await expect(panel.getByText("ChatGPT ready")).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText("Codex SDK 0.147.0")).toBeVisible();

    await panel.getByRole("textbox", { name: "Ask Copilot" }).fill("Return a concise local-library search for House tracks using only a genre filter.");
    await panel.getByRole("button", { name: "Run Copilot" }).click();
    await expect(panel.getByRole("region", { name: "Copilot result" })).toBeVisible({ timeout: 90_000 });

    await panel.getByRole("tab", { name: "Plan set" }).click();
    await panel.getByRole("textbox", { name: "Ask Copilot" }).fill("Propose a smooth three-track set plan from this local library.");
    await panel.getByRole("button", { name: "Run Copilot" }).click();
    const proposal = panel.getByRole("region", { name: "Copilot proposal" });
    const noChange = panel.getByText("Copilot did not propose a change");
    await expect(proposal.or(noChange)).toBeVisible({ timeout: 90_000 });
    if (await proposal.isVisible()) {
      await proposal.getByRole("button", { name: "Discard proposal" }).click();
    }

    await panel.getByRole("tab", { name: "Search" }).click();
    await panel.getByRole("textbox", { name: "Ask Copilot" }).fill("Search broadly and check the request carefully before returning results.");
    await panel.getByRole("button", { name: "Run Copilot" }).click();
    await expect(panel.getByRole("button", { name: "Cancel Copilot" })).toBeVisible({ timeout: 10_000 });
    await panel.getByRole("button", { name: "Cancel Copilot" }).click();
    await expect(panel.getByText(/cancelled/i)).toBeVisible({ timeout: 30_000 });

    const runtimeDirectory = await application.evaluate(() => (Reflect.get(globalThis, "__DJ_COPILOT_TEST_HOOK__") as { getRuntimeDirectory(): string }).getRuntimeDirectory());
    await application.close(); application = undefined;
    await expect(access(runtimeDirectory)).rejects.toThrow();
    console.log("M7_RELEASE_REAL_CODEX_SMOKE packaged=true auth=chatgpt sdk=0.147.0 bounded=true secondRequest=true planTerminal=true cancelled=true cleaned=true");
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
