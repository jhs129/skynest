import type { NextAuthConfig } from 'next-auth';
import GitHub from 'next-auth/providers/github';

export const authConfig: NextAuthConfig = {
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: { scope: 'read:user user:email repo' },
      },
    }),
  ],
  callbacks: {
    jwt({ token, account }) {
      if (account?.access_token) {
        token.githubAccessToken = account.access_token;
        token.githubLogin = (account as { login?: string }).login ?? token.name;
      }
      return token;
    },
    session({ session, token }) {
      (session as typeof session & { githubAccessToken?: string; githubLogin?: string }).githubAccessToken =
        token.githubAccessToken as string | undefined;
      (session as typeof session & { githubAccessToken?: string; githubLogin?: string }).githubLogin =
        token.githubLogin as string | undefined;
      return session;
    },
  },
};
