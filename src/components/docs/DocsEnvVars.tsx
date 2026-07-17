import { Section, InlineCode } from './shared';

type Req = 'required' | 'github' | 'entra' | 'optional' | 'auto';

interface EnvVar {
  name: string;
  req: Req;
  default?: string;
  description: string;
}

interface EnvGroup {
  title: string;
  note?: string;
  vars: EnvVar[];
}

const REQ_LABEL: Record<Req, { text: string; className: string }> = {
  required: { text: 'required', className: 'text-red-600' },
  github: { text: 'GitHub mode', className: 'text-emerald-700' },
  entra: { text: 'Entra mode', className: 'text-sky-700' },
  optional: { text: 'optional', className: 'text-gray-400' },
  auto: { text: 'auto-set', className: 'text-gray-400' },
};

const GROUPS: EnvGroup[] = [
  {
    title: 'Identity & sign-in',
    note: 'A single AUTH_PROVIDER selects the whole deployment’s identity mode — there is no dual sign-in picker.',
    vars: [
      { name: 'AUTH_PROVIDER', req: 'optional', default: 'github', description: "Identity mode: 'github' or 'entra'. Also drives authorization and the default vault-sync backend." },
      { name: 'GITHUB_CLIENT_ID', req: 'github', description: 'GitHub OAuth App client ID. The app requests the repo scope so the user token doubles as the git-write credential.' },
      { name: 'GITHUB_CLIENT_SECRET', req: 'github', description: 'GitHub OAuth App client secret.' },
      { name: 'ENTRA_TENANT_ID', req: 'entra', description: 'Entra tenant ID. Builds the issuer https://login.microsoftonline.com/<tenant>/v2.0. Throws if unset in Entra mode.' },
      { name: 'ENTRA_CLIENT_ID', req: 'entra', description: 'Entra app registration client ID for the Microsoft sign-in provider.' },
      { name: 'ENTRA_CLIENT_SECRET', req: 'entra', description: 'Entra app registration client secret.' },
      { name: 'AUTH_SECRET', req: 'required', description: 'NextAuth session/JWT encryption secret (openssl rand -base64 32). Read implicitly by NextAuth.' },
      { name: 'NEXTAUTH_URL', req: 'optional', description: 'Production base URL for NextAuth. Skynest also derives the base URL per-request, so this is mainly a NextAuth hint.' },
    ],
  },
  {
    title: 'Authorization (access control)',
    note: 'Decides whether a signed-in caller gets mcp:write, mcp:read, or a 403. See the Access control section.',
    vars: [
      { name: 'AUTHZ_GITHUB_REPO', req: 'github', description: "owner/repo whose GitHub collaborator permission decides access (push/admin → write, pull → read, none → 403). Usually the same as VAULT_REPO." },
      { name: 'AUTHZ_ENTRA_WRITE_GROUP_ID', req: 'entra', default: '(none → no write)', description: 'Comma-separated Entra group object ID(s) whose members get mcp:read + mcp:write.' },
      { name: 'AUTHZ_ENTRA_READ_GROUP_ID', req: 'entra', default: '(none → no read)', description: 'Comma-separated Entra group object ID(s) whose members get mcp:read only.' },
    ],
  },
  {
    title: 'OAuth token signing & registration',
    vars: [
      { name: 'OAUTH_PRIVATE_KEY', req: 'required', description: 'RS256 private key (full PEM) used to sign authorization codes and access tokens. From pnpm oauth:gen-keypair.' },
      { name: 'OAUTH_PUBLIC_KEY', req: 'required', description: 'RS256 public key (full PEM) used to verify self-issued tokens and published as JWKS.' },
      { name: 'ACCESS_TOKEN_TTL_SECONDS', req: 'optional', default: '604800 (7 days)', description: 'Lifetime of issued OAuth access tokens.' },
      { name: 'OAUTH_REGISTRATION_SECRET', req: 'optional', description: 'If set, dynamic client registration requires a matching Bearer token. If unset, registration falls back to loopback / allowlisted-origin checks.' },
      { name: 'OAUTH_ALLOWED_REDIRECT_ORIGINS', req: 'optional', default: "'' (loopback only)", description: 'Comma-separated HTTPS origins allowed as redirect URIs during registration (e.g. https://claude.ai for the Claude Desktop app).' },
    ],
  },
  {
    title: 'Trusted issuer (dual authorization server)',
    note: 'Optional. Leave both unset to keep self-issued-token-only behavior. Setting the issuer makes the audience mandatory (fails closed).',
    vars: [
      { name: 'MCP_TRUSTED_ISSUER', req: 'optional', description: 'External issuer URL (e.g. https://login.microsoftonline.com/<tenant>/v2.0). Tokens whose iss matches are verified against that tenant’s JWKS instead of the self-issued path.' },
      { name: 'MCP_TRUSTED_AUDIENCE', req: 'optional', description: 'Exact aud expected on trusted-issuer tokens (the api://<app-id> Identifier URI). Required whenever MCP_TRUSTED_ISSUER is set.' },
    ],
  },
  {
    title: 'Primary document store',
    note: 'Vercel Blob is the default cloud store; Azure Blob and local filesystem are the alternatives.',
    vars: [
      { name: 'CONTEXTNEST_STORAGE', req: 'optional', default: 'blob', description: "Storage mode: 'blob' (cloud) or 'fs' (local filesystem, for dev)." },
      { name: 'CONTEXTNEST_STORAGE_PROVIDER', req: 'optional', default: 'vercel', description: "When storage=blob, the backend: 'vercel' (Vercel Blob) or 'azure' (Azure Blob)." },
      { name: 'CONTEXTNEST_BLOB_PREFIX', req: 'required', description: "Namespace prefix for Vercel Blob objects (e.g. 'vault'). Required when provider=vercel." },
      { name: 'BLOB_READ_WRITE_TOKEN', req: 'auto', description: 'Injected automatically when a Vercel Blob store is connected. Do not set manually.' },
      { name: 'CONTEXTNEST_VAULT_PATH', req: 'optional', description: 'Local filesystem vault path. Required only when CONTEXTNEST_STORAGE=fs (local dev).' },
      { name: 'CONTEXTNEST_DEFAULT_VAULT_ID', req: 'optional', default: 'default', description: 'Vault ID used when a request does not specify one.' },
    ],
  },
  {
    title: 'Azure Blob — document store & OAuth client registry',
    note: 'The OAuth client registry is always Azure-backed, so one of these credentials is required in production in BOTH modes. The same account also serves the primary store when CONTEXTNEST_STORAGE_PROVIDER=azure. Distinct from the VAULT_AZURE_* sync vars below.',
    vars: [
      { name: 'AZURE_STORAGE_CONNECTION_STRING', req: 'required', description: 'Azure Blob connection string. Takes precedence over the account URL. One of this or AZURE_STORAGE_ACCOUNT_URL is required.' },
      { name: 'AZURE_STORAGE_ACCOUNT_URL', req: 'required', description: 'Azure Blob account URL used with managed identity (DefaultAzureCredential). Alternative to the connection string.' },
      { name: 'AZURE_BLOB_CONTAINER', req: 'optional', default: 'skynest', description: 'Container for documents and oauth-clients/<clientId>.json records.' },
    ],
  },
  {
    title: 'Vault sync (audit trail)',
    note: 'Records every write to a durable backend. All vars support a per-vault suffix override (e.g. VAULT_REPO_<VAULTID>).',
    vars: [
      { name: 'VAULT_SYNC_PROVIDER', req: 'optional', default: "computed ('github'/'azure'/'none')", description: "Force the sync backend. 'github' requires AUTH_PROVIDER=github (needs the repo-scoped user token)." },
      { name: 'VAULT_REPO', req: 'github', description: "owner/repo target for GitHub vault-sync commits. Required when the sync provider resolves to 'github'." },
      { name: 'VAULT_BRANCH', req: 'optional', default: 'main', description: 'Git branch for vault-sync commits.' },
      { name: 'VAULT_AZURE_STORAGE_CONNECTION_STRING', req: 'entra', description: "Azure connection string for the Azure vault-sync mirror. One of this or the account URL is required when the sync provider is 'azure'." },
      { name: 'VAULT_AZURE_STORAGE_ACCOUNT_URL', req: 'entra', description: 'Azure account URL (managed identity) for the vault-sync mirror.' },
      { name: 'VAULT_AZURE_CONTAINER', req: 'optional', default: 'skynest-vault-sync', description: 'Container name for the vault-sync mirror.' },
    ],
  },
  {
    title: 'Vault admin endpoint (init-from-git)',
    note: 'Only needed to use the /api/vault/init-from-git initialization endpoint.',
    vars: [
      { name: 'VAULT_ADMIN_TOKEN', req: 'optional', description: 'Bearer token compared against the Authorization header to authorize the headless vault-init flow.' },
      { name: 'VAULT_GITHUB_ADMIN_TOKEN', req: 'optional', description: 'GitHub admin token used by init-from-git to read/clone the vault repo during initialization.' },
    ],
  },
  {
    title: 'read.ai webhook',
    note: 'Only needed if you use the read.ai meeting-ingest webhook.',
    vars: [
      { name: 'WEBHOOK_API_KEY', req: 'optional', description: 'Secret embedded in the webhook URL path and compared against the [apikey] segment.' },
      { name: 'READ_AI_SIGNING_KEY', req: 'optional', description: 'HMAC-SHA256 key used to verify the read.ai webhook signature.' },
      { name: 'BOT_GITHUB_TOKEN', req: 'optional', description: 'GitHub PAT (repo scope) the webhook bot uses to commit meeting notes (no logged-in user exists). GitHub-sync deployments only.' },
      { name: 'AI_GATEWAY_API_KEY', req: 'optional', description: 'Vercel AI Gateway key for the Claude Haiku meeting classifier. Resolved automatically from the Vercel OIDC token when deployed; set it explicitly only off-Vercel or locally.' },
    ],
  },
  {
    title: 'Local development & escape hatch',
    note: 'Never set MCP_AUTH_DISABLED in a production deployment. See Local development.',
    vars: [
      { name: 'MCP_AUTH_DISABLED', req: 'optional', description: "When 'true', bypasses ALL bearer-token verification and grants full mcp:read + mcp:write with a synthetic identity. Local/testing only." },
      { name: 'MCP_AUTH_DISABLED_USER', req: 'optional', default: 'auth-disabled@skynest', description: 'Synthetic user attributed to writes while auth is disabled.' },
    ],
  },
];

function EnvTable({ vars }: { vars: EnvVar[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 pr-4 font-medium text-gray-700">Variable</th>
            <th className="text-left py-2 pr-4 font-medium text-gray-700">Required</th>
            <th className="text-left py-2 font-medium text-gray-700">Description</th>
          </tr>
        </thead>
        <tbody>
          {vars.map((v) => {
            const req = REQ_LABEL[v.req];
            return (
              <tr key={v.name} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-4 font-mono text-xs text-gray-800 whitespace-nowrap pt-3">{v.name}</td>
                <td className="py-2 pr-4 whitespace-nowrap pt-3">
                  <span className={`text-xs font-medium ${req.className}`}>{req.text}</span>
                </td>
                <td className="py-2 text-gray-500 text-xs pt-3">
                  {v.description}
                  {v.default ? <span className="text-gray-400"> Default: <span className="font-mono">{v.default}</span>.</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DocsEnvVars() {
  return (
    <Section id="env" title="Environment variables">
      <div className="space-y-8 text-gray-600">
        <div className="space-y-3 text-sm">
          <p>
            Every variable Skynest reads, grouped by subsystem. &ldquo;Required&rdquo; is
            conditional: <span className="font-mono text-xs text-emerald-700">GitHub mode</span> and{' '}
            <span className="font-mono text-xs text-sky-700">Entra mode</span> mark variables
            needed only under that <InlineCode>AUTH_PROVIDER</InlineCode>, and{' '}
            <span className="font-mono text-xs text-gray-400">auto-set</span> variables are
            injected by the platform.
          </p>
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-blue-800">
            <strong>Note:</strong> Azure Blob (<InlineCode>AZURE_STORAGE_*</InlineCode>) backs the
            persistent OAuth client registry in <em>both</em> modes, so you need an Azure Blob
            account in production even when running GitHub-native.
          </div>
        </div>

        {GROUPS.map((g) => (
          <div key={g.title} className="space-y-2">
            <h3 className="text-base font-medium text-gray-800">{g.title}</h3>
            {g.note ? <p className="text-sm text-gray-500">{g.note}</p> : null}
            <EnvTable vars={g.vars} />
          </div>
        ))}

        <p className="text-xs text-gray-400">
          The vendored Context Nest engine also recognizes a few internal variables
          (<InlineCode>CONTEXTNEST_TELEMETRY_URL</InlineCode>,{' '}
          <InlineCode>PROMPTOWL_API_URL</InlineCode>, <InlineCode>DEBUG</InlineCode>) used only by
          its CLI — none are needed to host Skynest.
        </p>
      </div>
    </Section>
  );
}
