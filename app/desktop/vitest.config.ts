import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: [resolve(here, "tests/setup.ts")],
    include: [resolve(here, "tests/**/*.test.{ts,tsx}")],
    exclude: [resolve(here, "e2e/**")],
  },
});
