// In-memory client registry for the OAuth 2.1 authorization server.
// Clients are registered via POST /oauth/register (RFC 7591 dynamic registration).
// This is intentionally in-memory; for multi-instance deployments swap for a
// persistent store backed by Vercel KV or similar.
//
// Stored on globalThis so Next.js hot-reload in dev doesn't wipe registered
// clients mid-flow (the GitHub OAuth round-trip takes long enough to trigger
// a module re-evaluation between registration and authorization).

export interface OAuthClientRecord {
  name: string;
  redirectUris: string[];
}

declare global {
  // eslint-disable-next-line no-var
  var __oauthClients: Map<string, OAuthClientRecord> | undefined;
}

const clients: Map<string, OAuthClientRecord> =
  globalThis.__oauthClients ?? (globalThis.__oauthClients = new Map());

export function registerClient(clientId: string, record: OAuthClientRecord): void {
  clients.set(clientId, record);
}

export function getClient(clientId: string): OAuthClientRecord | undefined {
  return clients.get(clientId);
}
