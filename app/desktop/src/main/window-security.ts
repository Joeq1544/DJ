export interface WindowOptions {
  webPreferences: {
    preload: string;
    contextIsolation: true;
    nodeIntegration: false;
    sandbox: true;
  };
}

interface NavigationEvent {
  preventDefault(): void;
}

interface GuardedWebContents {
  on(event: "will-navigate", listener: (event: NavigationEvent, url: string) => void): unknown;
  setWindowOpenHandler(listener: () => { action: "deny" }): unknown;
}

interface SecuritySession {
  webRequest: {
    onHeadersReceived(listener: (details: { responseHeaders?: Record<string, string[]> }, callback: (result: { responseHeaders: Record<string, string[]> }) => void) => void): unknown;
  };
}

function contentSecurityPolicy(development: boolean): string {
  return [
  "default-src 'self'",
  development ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  development
    ? "connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173"
    : "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  ].join("; ");
}

export function createWindowOptions(preloadPath: string): WindowOptions {
  return {
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

export function installWindowSecurity(webContents: GuardedWebContents, rendererUrl: string): void {
  webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl) event.preventDefault();
  });
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

export function installContentSecurityPolicy(session: SecuritySession, development = false): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy(development)],
      },
    });
  });
}
