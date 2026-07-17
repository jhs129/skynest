import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/oauth/urls', () => ({
  resolveServerUrls: vi.fn(async () => ({ baseUrl: new URL('https://example.com') })),
}));

describe('GET /.well-known/oauth-authorization-server', () => {
  afterEach(() => {
    delete process.env.MCP_AUTH_DISABLED;
  });

  it('returns authorization server metadata when auth is enabled', async () => {
    const { GET } = await import('./route.js');
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.issuer).toBe('https://example.com');
  });

  describe('with MCP_AUTH_DISABLED=true', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env.MCP_AUTH_DISABLED = 'true';
    });

    it('returns 404 so clients never discover an OAuth requirement', async () => {
      const { GET } = await import('./route.js');
      const response = await GET();
      expect(response.status).toBe(404);
    });
  });
});
