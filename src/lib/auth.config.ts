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
      }),
    ];
  }
  return [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
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
        // No git-write-capable token exists under Entra ID (and GitHub sync
        // is rejected under this mode anyway); only carry an attribution name.
        const entraProfile = profile as { preferred_username?: string; email?: string } | undefined;
        token.idpLogin = entraProfile?.preferred_username ?? entraProfile?.email ?? token.name;
      }
      return token;
    },
    session({ session, token }) {
      (session as typeof session & { idpAccessToken?: string; idpLogin?: string }).idpAccessToken =
        token.idpAccessToken as string | undefined;
      (session as typeof session & { idpAccessToken?: string; idpLogin?: string }).idpLogin =
        token.idpLogin as string | undefined;
      return session;
    },
  },
};
