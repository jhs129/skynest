import { Section, CodeBlock, InlineCode } from './shared';

export function DocsArchitecture() {
  return (
    <Section id="architecture" title="Architecture">
      <div className="space-y-4 text-gray-600">
        <CodeBlock>{`   ┌──────────────────────────────────────────────────────────────────────┐
   │ Skynest — Hosted Context Nest MCP server (Vercel / Next.js)           │
   │   • Next.js App Router, mcp-handler, /api/mcp route                   │
   │   • GitHub OAuth 2.1 (PKCE + dynamic client registration + RS256 JWT) │
   │   • Context Nest engine (vendored fork) used as a library             │
   │     — StorageProvider interface; BlobStorageProvider on Vercel        │
   │   • Vault files: Vercel Blob (read/write) + GitHub API (commit/history)│
   │   • /api/webhooks/[apikey]/[vaultId]/readai (read.ai ingest)           │
   └───────▲──────────────────────────────────────────────┬────────────────┘
           │ MCP over HTTPS (GitHub OAuth)                 │ GitHub API
           │                                               ▼
   Claude Code / Cursor /                        Private git repo
   any MCP-compatible tool                       <owner>/contextnest-vault
   (each user's own GitHub                       (source of truth +
    account → attributed commits)                 full version history)
           ▲
           │ webhook POST (HMAC signed)
   read.ai (meeting_end event)`}</CodeBlock>
        <div className="space-y-2 text-sm">
          <p>
            <strong className="text-gray-800">Storage:</strong> Vault document files are stored
            in <strong className="text-gray-800">Vercel Blob</strong> (fast reads, always
            available). Every write also goes to a private GitHub repository via the GitHub REST
            API — this is the source of truth for version history and git attribution.
          </p>
          <p>
            <strong className="text-gray-800">Auth:</strong> OAuth 2.1 with PKCE and RS256 JWTs.
            The identity provider is pluggable via <InlineCode>AUTH_PROVIDER</InlineCode> — GitHub
            or Microsoft Entra ID. MCP clients receive a short-lived Bearer token carrying{' '}
            <InlineCode>mcp:read</InlineCode>/<InlineCode>mcp:write</InlineCode> scopes decided by
            an <InlineCode>AuthorizationProvider</InlineCode> (see{' '}
            <a href="#access" className="text-indigo-600 hover:underline">Access control</a>). In
            GitHub mode the user&apos;s access token is embedded so writes are committed under
            their identity.
          </p>
          <p>
            <strong className="text-gray-800">Vault sync:</strong> pluggable via{' '}
            <InlineCode>VAULT_SYNC_PROVIDER</InlineCode>. <InlineCode>github</InlineCode> commits
            each write to a private repo through the GitHub API; <InlineCode>azure</InlineCode>{' '}
            records writes as versioned Azure Blob uploads (with a tombstone version on delete);{' '}
            <InlineCode>none</InlineCode> disables sync. Vercel Blob remains the primary read/write
            document store in all modes.
          </p>
          <p>
            <strong className="text-gray-800">Engine:</strong> The{' '}
            <InlineCode>@promptowl/contextnest-engine</InlineCode> package is vendored and
            used as a library — no stdio process, no vault path on disk. The storage layer is
            abstracted behind a <InlineCode>StorageProvider</InlineCode> interface; Skynest
            provides the Blob implementation.
          </p>
        </div>
        <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
          <strong className="text-gray-700">Tech stack:</strong> Next.js 15 App Router ·
          TypeScript · pnpm · <InlineCode>mcp-handler</InlineCode> ·{' '}
          <InlineCode>@vercel/blob</InlineCode> · NextAuth v5 (GitHub provider) ·{' '}
          <InlineCode>jose</InlineCode> (RS256 JWTs) · <InlineCode>zod</InlineCode>
        </div>
      </div>
    </Section>
  );
}
