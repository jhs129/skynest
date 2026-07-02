export type AuthorizationLevel = 'write' | 'read' | 'none';

export interface AuthorizationIdentity {
  /** IdP access token: GitHub repo-scoped token, or an Entra token usable against Microsoft Graph. */
  idpAccessToken: string;
  /**
   * Entra only. Group IDs from the ID token's `groups` claim, when present and
   * not affected by the groups-overage limit. Undefined means "claim absent or
   * overage occurred" — the provider must fall back to a Graph API call.
   */
  idpGroups?: string[];
}

export interface AuthorizationProvider {
  checkAccess(identity: AuthorizationIdentity): Promise<AuthorizationLevel>;
}
