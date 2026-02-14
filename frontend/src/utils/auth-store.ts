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

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}
