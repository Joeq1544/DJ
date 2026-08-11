export interface QuitEvent {
  preventDefault(): void;
}

export interface QuitApp {
  on(event: "before-quit", listener: (event: QuitEvent) => void): unknown;
  quit(): void;
}

export function installGracefulShutdown(app: QuitApp, stop: () => Promise<void>): void {
  let cleanupInProgress = false;
  let cleanupCompleted = false;
  app.on("before-quit", (event) => {
    if (cleanupCompleted) return;
    event.preventDefault();
    if (cleanupInProgress) return;
    cleanupInProgress = true;
    void stop().catch(() => undefined).finally(() => {
      cleanupInProgress = false;
      cleanupCompleted = true;
      app.quit();
    });
  });
}
