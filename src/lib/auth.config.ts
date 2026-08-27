import type { NextAuthConfig } from 'next-auth';
import GitHub from 'next-auth/providers/github';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';

const authProvider = process.env.AUTH_PROVIDER ?? 'github';

// A single AUTH_PROVIDER selects the whole deployment's identity mode — no
// dual sign-in picker. This is also what src/lib/vault/sync/vault-sync-factory.ts
// checks to refuse GitHub-backed sync when GitHub OAuth (and its repo-scoped
// user token) isn't the active login mode.
function buildProviders() {
  if (authProvider === 'entra') {
    const tenantId = process.env.ENTRA_TENANT_ID;
    if (!tenantId) {
      throw new Error('ENTRA_TENANT_ID is required when AUTH_PROVIDER=entra');
    }
    return [
      MicrosoftEntraID({
        clientId: process.env.ENTRA_CLIENT_ID!,
        clientSecret: process.env.ENTRA_CLIENT_SECRET!,
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        authorization: {
          params: { scope: 'openid profile email GroupMember.Read.All' },
        },
      }),
    ];
  }
  return [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      // GitHub now returns an "iss" callback param (RFC 9207); Auth.js's
      // GitHub preset has no issuer configured, so it rejects it unless we
      // declare the issuer explicitly.
      issuer: 'https://github.com/login/oauth',
      authorization: {
        params: { scope: 'read:user user:email repo' },
      },
    }),
  ];
}

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: '/auth/signin',
  },
  providers: buildProviders(),
  callbacks: {
    jwt({ token, account, profile }) {
      if (account?.provider === 'github' && account.access_token) {
        // The repo-scoped GitHub token doubles as the git-write credential
        // GitHubVaultSyncProvider commits with — see idpAccessToken usage
        // downstream in src/app/oauth/token/route.ts.
        token.idpAccessToken = account.access_token;
        token.idpLogin = (account as { login?: string }).login ?? token.name;
      } else if (account?.provider === 'microsoft-entra-id') {
        // The access token is used against Microsoft Graph's checkMemberGroups
        // as a fallback when the groups claim is absent (see EntraAuthorizationProvider).
        token.idpAccessToken = account.access_token;
        const entraProfile = profile as
          | { preferred_username?: string; email?: string; groups?: string[] }
          | undefined;
        token.idpLogin = entraProfile?.preferred_username ?? entraProfile?.email ?? token.name;
        token.idpGroups = entraProfile?.groups;
      }
      return token;
    },
    session({ session, token }) {
      const s = session as typeof session & {
        idpAccessToken?: string;
        idpLogin?: string;
        idpGroups?: string[];
      };
      s.idpAccessToken = token.idpAccessToken as string | undefined;
      s.idpLogin = token.idpLogin as string | undefined;
      s.idpGroups = token.idpGroups as string[] | undefined;
      return session;
    },
  },
};
