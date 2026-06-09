import { Section, SubSection, CodeBlock, InlineCode } from './shared';

const ENV_VARS = [
  { name: 'AUTH_GITHUB_ID', required: true, description: 'GitHub OAuth App Client ID' },
  { name: 'AUTH_GITHUB_SECRET', required: true, description: 'GitHub OAuth App Client Secret' },
  { name: 'AUTH_SECRET', required: true, description: 'NextAuth secret — run: openssl rand -base64 32' },
  { name: 'NEXTAUTH_URL', required: true, description: 'Your production URL (e.g. https://skynest.vercel.app). Must exactly match the OAuth callback base URL.' },
  { name: 'OAUTH_PRIVATE_KEY', required: true, description: 'RS256 private key (from pnpm oauth:gen-keypair). Include the full PEM block.' },
  { name: 'OAUTH_PUBLIC_KEY', required: true, description: 'RS256 public key (from pnpm oauth:gen-keypair). Include the full PEM block.' },
  { name: 'CONTEXTNEST_STORAGE', required: true, description: "Set to 'blob' in production" },
  { name: 'CONTEXTNEST_BLOB_PREFIX', required: true, description: "Namespace prefix for Blob objects (e.g. 'vault'). Keeps vault files isolated from any other Blob content." },
  { name: 'BLOB_READ_WRITE_TOKEN', required: true, description: 'Auto-set when you connect a Vercel Blob store to your project. Do not set manually.' },
  { name: 'VAULT_REPO', required: true, description: "Vault GitHub repo in owner/repo format (e.g. acme/my-vault). Every MCP write is committed here under the authenticated user's identity." },
  { name: 'VAULT_BRANCH', required: false, description: "Git branch for vault sync commits (default: main)" },
  { name: 'VAULT_SYNC_PROVIDER', required: false, description: "'github' (default) or 'none' to disable git sync entirely" },
  { name: 'CONTEXTNEST_DEFAULT_VAULT_ID', required: false, description: "Default vault ID used when none is specified (default: 'default')" },
  { name: 'ACCESS_TOKEN_TTL_SECONDS', required: false, description: 'OAuth access token lifetime in seconds (default: 604800 = 7 days)' },
  { name: 'WEBHOOK_API_KEY', required: false, description: 'Secret embedded in the read.ai webhook URL. Required only if using the webhook.' },
  { name: 'READ_AI_SIGNING_KEY', required: false, description: 'HMAC signing key from the read.ai dashboard. Required only if using the webhook.' },
  { name: 'BOT_GITHUB_TOKEN', required: false, description: 'GitHub PAT (repo scope) for vault commits made by the webhook bot. Required only if using the read.ai webhook.' },
];

export function DocsDeployment() {
  return (
    <Section id="deploy" title="Deploying Skynest">
      <div className="space-y-8 text-gray-600">
        <SubSection title="Prerequisites">
          <ul className="space-y-1 text-sm list-disc list-inside">
            <li>A <a href="https://vercel.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Vercel</a> account (Hobby tier works; Pro unlocks longer function timeouts)</li>
            <li>A <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">GitHub</a> account — you&apos;ll register an OAuth App and create a vault repo</li>
            <li>pnpm ≥ 9 and Node.js ≥ 20 installed locally</li>
            <li>The Vercel CLI: <InlineCode>pnpm add -g vercel</InlineCode></li>
            <li>A fork or clone of this repo pushed to your GitHub account</li>
          </ul>
        </SubSection>

        <SubSection title="1. Fork and clone the repo">
          <p className="text-sm">
            Fork <strong className="text-gray-800">jhs129/skynest</strong> on GitHub, then clone your fork locally:
          </p>
          <CodeBlock>{`git clone https://github.com/<you>/skynest.git
cd skynest
pnpm install`}</CodeBlock>
        </SubSection>

        <SubSection title="2. Create the vault repository">
          <p className="text-sm">
            The vault repo is a <strong className="text-gray-800">private</strong> GitHub repository
            that stores a version-controlled copy of every document. Every MCP write is committed
            there under the authenticated user&apos;s GitHub identity. Create it first, then push
            any existing vault content:
          </p>
          <CodeBlock>{`# Push an existing local Context Nest vault to a new GitHub repo
bash scripts/init-vault.sh /path/to/your/vault https://github.com/<you>/my-vault.git`}</CodeBlock>
          <p className="text-sm">
            If you&apos;re starting fresh with no existing vault, create an empty private repo on
            GitHub — the vault initializes automatically on first write.
          </p>
          <p className="text-sm">
            Add team members as collaborators on the vault repo so their GitHub tokens can commit.
          </p>
        </SubSection>

        <SubSection title="3. Register a GitHub OAuth App">
          <p className="text-sm">
            Go to <strong className="text-gray-800">GitHub → Settings → Developer settings → OAuth Apps → New OAuth App</strong>.
            You&apos;ll need to know your final Vercel URL first — if deploying to a custom domain,
            use that; otherwise use the <InlineCode>*.vercel.app</InlineCode> URL Vercel assigns
            after the first deploy (you can update the callback URL later).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 pr-4 font-medium text-gray-700">Field</th>
                  <th className="text-left py-2 font-medium text-gray-700">Value</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Application name', 'Skynest'],
                  ['Homepage URL', 'https://<your-app>.vercel.app'],
                  ['Authorization callback URL', 'https://<your-app>.vercel.app/api/auth/callback/github'],
                ].map(([field, val]) => (
                  <tr key={field} className="border-b border-gray-100">
                    <td className="py-2 pr-4 text-gray-600">{field}</td>
                    <td className="py-2 font-mono text-xs text-gray-800">{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm mt-2">
            After saving, note the <strong className="text-gray-800">Client ID</strong> and generate
            a <strong className="text-gray-800">Client Secret</strong>. You&apos;ll need both for
            env vars.
          </p>
        </SubSection>

        <SubSection title="4. Generate OAuth signing keys">
          <p className="text-sm">
            Skynest issues RS256-signed JWTs for MCP OAuth. Generate the key pair:
          </p>
          <CodeBlock>{`pnpm oauth:gen-keypair`}</CodeBlock>
          <p className="text-sm">
            Copy the printed <InlineCode>OAUTH_PRIVATE_KEY</InlineCode> and{' '}
            <InlineCode>OAUTH_PUBLIC_KEY</InlineCode> values — paste the full PEM block
            (including the <InlineCode>-----BEGIN...-----</InlineCode> header/footer) into
            Vercel as a single env var value.
          </p>
        </SubSection>

        <SubSection title="5. Create your Vercel project">
          <p className="text-sm">
            Link your forked repo to Vercel using one of these methods:
          </p>
          <p className="text-sm font-medium text-gray-700 mt-3">Option A — Vercel dashboard (recommended)</p>
          <ol className="space-y-1 text-sm list-decimal list-inside ml-2">
            <li>Go to <strong className="text-gray-800">vercel.com/new</strong></li>
            <li>Click <strong className="text-gray-800">Import Git Repository</strong> and select your fork</li>
            <li>Vercel auto-detects Next.js — leave the framework preset and build settings as-is</li>
            <li>Do <strong className="text-gray-800">not</strong> deploy yet — add env vars first (next step)</li>
          </ol>
          <p className="text-sm font-medium text-gray-700 mt-3">Option B — Vercel CLI</p>
          <CodeBlock>{`vercel login
vercel link   # follow the prompts to create or select a project`}</CodeBlock>
        </SubSection>

        <SubSection title="6. Provision Vercel Blob">
          <p className="text-sm">
            Blob is Skynest&apos;s primary document store. You must create and connect a store
            before deploying:
          </p>
          <ol className="space-y-1 text-sm list-decimal list-inside ml-2">
            <li>In the Vercel dashboard, open your project and go to the <strong className="text-gray-800">Storage</strong> tab</li>
            <li>Click <strong className="text-gray-800">Create Database</strong> → <strong className="text-gray-800">Blob</strong></li>
            <li>Give the store a name (e.g. <InlineCode>skynest-vault</InlineCode>)</li>
            <li>Click <strong className="text-gray-800">Connect</strong> — Vercel automatically adds <InlineCode>BLOB_READ_WRITE_TOKEN</InlineCode> to your project&apos;s environment variables</li>
          </ol>
          <p className="text-sm mt-2">
            You can also do this via CLI:
          </p>
          <CodeBlock>{`vercel storage add blob
# then link it to your project when prompted`}</CodeBlock>
        </SubSection>

        <SubSection title="7. Set environment variables">
          <p className="text-sm">
            Set all required variables in <strong className="text-gray-800">Project Settings → Environment Variables</strong>.
            Scope each variable to <strong className="text-gray-800">Production</strong> (and Preview/Development
            if you want those deployments to work too):
          </p>
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
                {ENV_VARS.map((v) => (
                  <tr key={v.name} className="border-b border-gray-100">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-800 whitespace-nowrap">{v.name}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs font-medium ${v.required ? 'text-red-600' : 'text-gray-400'}`}>
                        {v.required ? 'required' : 'optional'}
                      </span>
                    </td>
                    <td className="py-2 text-gray-500 text-xs">{v.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm mt-3">
            Alternatively, set variables in bulk via the CLI:
          </p>
          <CodeBlock>{`vercel env add AUTH_GITHUB_ID
vercel env add AUTH_GITHUB_SECRET
vercel env add AUTH_SECRET
# ... repeat for each variable
vercel env pull .env.local   # pull all vars into local .env.local for dev`}</CodeBlock>
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800 mt-3">
            <strong>Important:</strong> Do not set <InlineCode>BLOB_READ_WRITE_TOKEN</InlineCode> manually.
            It is injected automatically when the Blob store is connected to your project.
          </div>
        </SubSection>

        <SubSection title="8. Deploy">
          <p className="text-sm">
            Trigger the first production deployment from the dashboard or CLI:
          </p>
          <CodeBlock>{`git push origin main   # Vercel auto-deploys on push to main`}</CodeBlock>
          <p className="text-sm">
            Or manually trigger from the <strong className="text-gray-800">Deployments</strong> tab
            → <strong className="text-gray-800">Redeploy</strong>.
          </p>
        </SubSection>

        <SubSection title="9. Update the GitHub OAuth callback URL">
          <p className="text-sm">
            If you registered the OAuth App before your final URL was known, update the callback
            URL now. Go to your OAuth App settings on GitHub and set:
          </p>
          <CodeBlock>{`Authorization callback URL:
https://<your-final-url>/api/auth/callback/github`}</CodeBlock>
          <p className="text-sm">
            Also update <InlineCode>NEXTAUTH_URL</InlineCode> in Vercel to match, then
            redeploy.
          </p>
        </SubSection>

        <SubSection title="10. Verify">
          <p className="text-sm">
            Open your deployment URL and check these endpoints:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {[
                  ['/', 'Skynest home page — confirms the app is running'],
                  ['/admin', 'Admin panel — sign in with GitHub to confirm OAuth works'],
                  ['/api/mcp', 'Returns 405 (no GET) — confirms the MCP route is live'],
                  ['/api/oauth/authorization_server', 'Returns OAuth metadata JSON — confirms OAuth is configured'],
                ].map(([path, desc]) => (
                  <tr key={path} className="border-b border-gray-100">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-800 whitespace-nowrap">{path}</td>
                    <td className="py-2 text-gray-500 text-xs">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm mt-3">
            To verify the MCP endpoint is working with an AI tool, follow the{' '}
            <a href="#connect" className="text-indigo-600 hover:underline">Connecting your AI tool</a>{' '}
            instructions.
          </p>
        </SubSection>

        <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800">
          <strong>Vault sync note:</strong> MCP write tools commit to the vault GitHub repo using
          each user&apos;s own GitHub OAuth token — no extra PAT is required for regular use.
          The <InlineCode>BOT_GITHUB_TOKEN</InlineCode> is only needed for the read.ai webhook,
          which runs outside any user session.
        </div>
      </div>
    </Section>
  );
}
