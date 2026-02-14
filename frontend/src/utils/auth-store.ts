/**
 * Session Token Store
 *
 * Stores the session token in memory (not localStorage) for REST API authentication.
 * The token is obtained from the WebSocket AUTH flow and injected into all REST calls
 * via the safeBackendFetch wrapper.
 *
 * Token lifecycle:
 * - Set on successful WS AUTH (AUTH_SUCCESS response)
 * - Cleared on WS disconnect or explicit logout
 * - Never persisted to disk/localStorage
 */

let sessionToken: string | null = null;
let tokenWaiters: Array<() => void> = [];

export function setSessionToken(token: string | null): void {
  sessionToken = token;
  if (token && tokenWaiters.length > 0) {
    const waiters = tokenWaiters;
    tokenWaiters = [];
    waiters.forEach(resolve => resolve());
  }
}

export function getSessionToken(): string | null {
  return sessionToken;
}

/** Wait until a session token is available (resolves immediately if already set) */
export function waitForToken(timeoutMs: number = 15000): Promise<void> {
  if (sessionToken) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      tokenWaiters = tokenWaiters.filter(w => w !== resolve);
      reject(new Error('Auth token timeout'));
    }, timeoutMs);
    const wrappedResolve = () => {
      clearTimeout(timer);
      resolve();
    };
    tokenWaiters.push(wrappedResolve);
  });
}
