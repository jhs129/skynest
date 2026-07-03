import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthorizationProvider } from './authorization-factory.js';
import { GitHubAuthorizationProvider } from './providers/github-authorization-provider.js';
import { EntraAuthorizationProvider } from './providers/entra-authorization-provider.js';

describe('createAuthorizationProvider', () => {
  beforeEach(() => {
    delete process.env.AUTH_PROVIDER;
    delete process.env.AUTHZ_GITHUB_REPO;
    delete process.env.AUTHZ_ENTRA_WRITE_GROUP_ID;
    delete process.env.AUTHZ_ENTRA_READ_GROUP_ID;
  });

  it('returns a GitHubAuthorizationProvider when AUTH_PROVIDER is unset', () => {
    process.env.AUTHZ_GITHUB_REPO = 'owner/repo';
    const provider = createAuthorizationProvider();
    expect(provider).toBeInstanceOf(GitHubAuthorizationProvider);
  });

  it('returns a GitHubAuthorizationProvider when AUTH_PROVIDER=github', () => {
    process.env.AUTH_PROVIDER = 'github';
    process.env.AUTHZ_GITHUB_REPO = 'owner/repo';
    const provider = createAuthorizationProvider();
    expect(provider).toBeInstanceOf(GitHubAuthorizationProvider);
  });

  it('throws when AUTH_PROVIDER=github (or unset) and AUTHZ_GITHUB_REPO is missing', () => {
    expect(() => createAuthorizationProvider()).toThrow(
      /AUTHZ_GITHUB_REPO env var is required when AUTH_PROVIDER=github/,
    );
  });

  it('returns an EntraAuthorizationProvider when AUTH_PROVIDER=entra', () => {
    process.env.AUTH_PROVIDER = 'entra';
    process.env.AUTHZ_ENTRA_WRITE_GROUP_ID = 'write-group-id';
    process.env.AUTHZ_ENTRA_READ_GROUP_ID = 'read-group-id';
    const provider = createAuthorizationProvider();
    expect(provider).toBeInstanceOf(EntraAuthorizationProvider);
  });

  it('returns an EntraAuthorizationProvider under AUTH_PROVIDER=entra even with no group env vars set (the provider itself fails closed, not the factory)', () => {
    process.env.AUTH_PROVIDER = 'entra';
    const provider = createAuthorizationProvider();
    expect(provider).toBeInstanceOf(EntraAuthorizationProvider);
  });

  it('parses comma-separated group IDs (with whitespace) into multiple write groups', async () => {
    process.env.AUTH_PROVIDER = 'entra';
    process.env.AUTHZ_ENTRA_WRITE_GROUP_ID = 'careteam-group-id, led-group-id';
    const provider = createAuthorizationProvider();
    await expect(
      provider.checkAccess({ idpAccessToken: 'tok', idpGroups: ['led-group-id'] }),
    ).resolves.toBe('write');
  });
});
