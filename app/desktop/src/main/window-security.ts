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

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:5173",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

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

export function installContentSecurityPolicy(session: SecuritySession): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CONTENT_SECURITY_POLICY],
      },
    });
  });
}
