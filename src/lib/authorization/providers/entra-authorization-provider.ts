import type {
  AuthorizationLevel,
  AuthorizationProvider,
  AuthorizationIdentity,
} from '../authorization-provider.js';

export interface EntraAuthorizationProviderConfig {
  writeGroupId?: string;
  readGroupId?: string;
}

export class EntraAuthorizationProvider implements AuthorizationProvider {
  constructor(private readonly config: EntraAuthorizationProviderConfig) {}

  async checkAccess(identity: AuthorizationIdentity): Promise<AuthorizationLevel> {
    const { writeGroupId, readGroupId } = this.config;
    if (!writeGroupId && !readGroupId) return 'none';

    const groups = identity.idpGroups ?? (await this.fetchGroupMemberships(identity.idpAccessToken));
    return this.levelFromGroups(groups);
  }

  private levelFromGroups(groups: string[]): AuthorizationLevel {
    const { writeGroupId, readGroupId } = this.config;
    if (writeGroupId && groups.includes(writeGroupId)) return 'write';
    if (readGroupId && groups.includes(readGroupId)) return 'read';
    return 'none';
  }

  private async fetchGroupMemberships(idpAccessToken: string): Promise<string[]> {
    const groupIds = [this.config.writeGroupId, this.config.readGroupId].filter(
      (id): id is string => Boolean(id),
    );
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
