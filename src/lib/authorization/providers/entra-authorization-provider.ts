import type {
  AuthorizationLevel,
  AuthorizationProvider,
  AuthorizationIdentity,
} from '../authorization-provider.js';

export interface EntraAuthorizationProviderConfig {
  writeGroupIds?: string[];
  readGroupIds?: string[];
}

export class EntraAuthorizationProvider implements AuthorizationProvider {
  private readonly writeGroupIds: string[];
  private readonly readGroupIds: string[];

  constructor(config: EntraAuthorizationProviderConfig) {
    this.writeGroupIds = config.writeGroupIds ?? [];
    this.readGroupIds = config.readGroupIds ?? [];
  }

  async checkAccess(identity: AuthorizationIdentity): Promise<AuthorizationLevel> {
    if (this.writeGroupIds.length === 0 && this.readGroupIds.length === 0) return 'none';

    const groups = identity.idpGroups ?? (await this.fetchGroupMemberships(identity.idpAccessToken));
    return this.levelFromGroups(groups);
  }

  private levelFromGroups(groups: string[]): AuthorizationLevel {
    if (this.writeGroupIds.some((id) => groups.includes(id))) return 'write';
    if (this.readGroupIds.some((id) => groups.includes(id))) return 'read';
    return 'none';
  }

  private async fetchGroupMemberships(idpAccessToken: string): Promise<string[]> {
    const groupIds = [...this.writeGroupIds, ...this.readGroupIds];
    const res = await fetch('https://graph.microsoft.com/v1.0/me/checkMemberGroups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idpAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ groupIds }),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as { value?: string[] };
    return data.value ?? [];
  }
}
