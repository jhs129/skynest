import { Section, SubSection, CodeBlock, InlineCode } from '../shared';
import { GitHubModeSteps } from './GitHubModeSteps';
import { EntraModeSteps } from './EntraModeSteps';

export function DocsDeployment() {
  return (
    <Section id="deploy" title="Deploying Skynest">
      <div className="space-y-8 text-gray-600">
        <SubSection title="Choose an identity mode">
          <p className="text-sm">
            Skynest runs in one of two modes, selected by the{' '}
            <InlineCode>AUTH_PROVIDER</InlineCode> environment variable. Pick one per deployment —
            there is no in-app sign-in picker.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-emerald-200 p-4 space-y-1">
              <div className="font-medium text-emerald-800 text-sm">GitHub-native (default)</div>
              <div className="text-sm text-gray-500">
                GitHub sign-in · access by repo permission · writes committed to a private repo
                under each user&apos;s identity.
              </div>
            </div>
            <div className="rounded-lg border border-sky-200 p-4 space-y-1">
              <div className="font-medium text-sky-800 text-sm">Azure-native (Entra ID)</div>
              <div className="text-sm text-gray-500">
                Microsoft sign-in · access by security-group membership · writes recorded as
                versioned Azure Blob uploads.
              </div>
            </div>
          </div>
        </SubSection>

        <SubSection title="Prerequisites">
          <ul className="space-y-1 text-sm list-disc list-inside">
            <li>A <a href="https://vercel.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Vercel</a> account (Hobby works; Pro unlocks longer function timeouts)</li>
            <li>An <strong className="text-gray-800">Azure Blob Storage</strong> account — required in both modes for the persistent OAuth client registry</li>
            <li>Either a <strong className="text-gray-800">GitHub</strong> account (GitHub mode) or a <strong className="text-gray-800">Microsoft Entra</strong> tenant with admin access (Entra mode)</li>
            <li>pnpm ≥ 9 and Node.js ≥ 20 locally, plus the Vercel CLI (<InlineCode>pnpm add -g vercel</InlineCode>)</li>
          </ul>
        </SubSection>

        <div className="space-y-1">
          <h3 className="text-base font-semibold text-gray-900">Common setup (both modes)</h3>
          <p className="text-sm text-gray-500">Do these regardless of the mode you chose.</p>
        </div>

        <SubSection title="1. Fork, clone, and install">
          <CodeBlock>{`git clone https://github.com/<you>/skynest.git
cd skynest
pnpm install`}</CodeBlock>
        </SubSection>

        <SubSection title="2. Generate OAuth signing keys">
          <p className="text-sm">
            Skynest issues RS256-signed JWTs for MCP OAuth. Generate the key pair and paste each
            full PEM block (including the <InlineCode>-----BEGIN...-----</InlineCode> lines) into
            Vercel as <InlineCode>OAUTH_PRIVATE_KEY</InlineCode> and{' '}
            <InlineCode>OAUTH_PUBLIC_KEY</InlineCode>:
          </p>
          <CodeBlock>{`pnpm oauth:gen-keypair`}</CodeBlock>
        </SubSection>

        <SubSection title="3. Create the Vercel project and connect Vercel Blob">
          <ol className="space-y-1 text-sm list-decimal list-inside ml-2">
            <li>Import your fork at <strong className="text-gray-800">vercel.com/new</strong> (Next.js is auto-detected) — don&apos;t deploy yet.</li>
            <li>Open the project&apos;s <strong className="text-gray-800">Storage</strong> tab → <strong className="text-gray-800">Create Database → Blob</strong>, then <strong className="text-gray-800">Connect</strong>. This injects <InlineCode>BLOB_READ_WRITE_TOKEN</InlineCode> automatically — do not set it by hand.</li>
          </ol>
        </SubSection>

        <SubSection title="4. Provision Azure Blob for the OAuth client registry">
          <p className="text-sm">
            The dynamic OAuth client registry is stored in Azure Blob so registrations survive
            across serverless instances. This is required in <strong className="text-gray-800">both</strong> modes.
            Create a storage account and set one credential plus (optionally) the container name:
          </p>
          <CodeBlock>{`AZURE_STORAGE_ACCOUNT_URL=https://<account>.blob.core.windows.net
# or: AZURE_STORAGE_CONNECTION_STRING=<connection-string>
AZURE_BLOB_CONTAINER=skynest          # optional, defaults to "skynest"`}</CodeBlock>
        </SubSection>

        <SubSection title="5. Set the common environment variables">
          <CodeBlock>{`AUTH_SECRET=<random>                  # openssl rand -base64 32
NEXTAUTH_URL=https://<your-app>.vercel.app
OAUTH_PRIVATE_KEY=<from step 2>
OAUTH_PUBLIC_KEY=<from step 2>

# Primary document store (Vercel Blob)
CONTEXTNEST_STORAGE=blob
CONTEXTNEST_STORAGE_PROVIDER=vercel   # or "azure" to store documents in Azure too
CONTEXTNEST_BLOB_PREFIX=vault`}</CodeBlock>
          <p className="text-sm">
            The full, categorized list — including optional and webhook variables — is in the{' '}
            <a href="#env" className="text-indigo-600 hover:underline">Environment variables</a>{' '}
            section.
          </p>
        </SubSection>

        <div className="space-y-1 pt-2">
          <h3 className="text-base font-semibold text-gray-900">Mode-specific setup</h3>
          <p className="text-sm text-gray-500">Follow the block matching your chosen mode.</p>
        </div>

        <GitHubModeSteps />
        <EntraModeSteps />

        <div className="space-y-1 pt-2">
          <h3 className="text-base font-semibold text-gray-900">Finish</h3>
        </div>

        <SubSection title="6. Deploy">
          <p className="text-sm">Push to your default branch — Vercel auto-deploys:</p>
          <CodeBlock>{`git push origin main`}</CodeBlock>
          <p className="text-sm">
            If you registered your OAuth App / Entra redirect URI before the final URL was known,
            update it now to the deployed URL and redeploy.
          </p>
        </SubSection>

        <SubSection title="7. Verify">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {[
                  ['/', 'Home page — confirms the app is running'],
                  ['/admin', 'Sign in to confirm OAuth works in your chosen mode'],
                  ['/api/mcp', 'Returns 405 (no GET) — confirms the MCP route is live'],
                  ['/.well-known/oauth-protected-resource', 'Lists the authorization server(s); shows the trusted issuer too if configured'],
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
            Then connect an AI tool following{' '}
            <a href="#connect" className="text-indigo-600 hover:underline">Connecting your AI tool</a>.
          </p>
        </SubSection>
      </div>
    </Section>
  );
}
