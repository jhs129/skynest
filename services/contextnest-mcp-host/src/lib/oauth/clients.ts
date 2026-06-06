// In-memory client registry for the OAuth 2.1 authorization server.
// Clients are registered via POST /oauth/register (RFC 7591 dynamic registration).
// This is intentionally in-memory; for multi-instance deployments swap for a
// persistent store backed by Vercel KV or similar.

export interface OAuthClientRecord {
  name: string;
  redirectUris: string[];
}

const clients = new Map<string, OAuthClientRecord>();

export function registerClient(clientId: string, record: OAuthClientRecord): void {
  clients.set(clientId, record);
}

export function getClient(clientId: string): OAuthClientRecord | undefined {
  return clients.get(clientId);
}
