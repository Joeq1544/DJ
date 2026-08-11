import type { DesktopApi } from "../shared/contracts";

declare global {
  interface Window {
    djCopilot: DesktopApi;
  }
}

export {};
