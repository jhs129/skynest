import { Section, CodeBlock, InlineCode } from './shared';

export function DocsLocalDev() {
  return (
    <Section id="local-dev" title="Local development">
      <div className="space-y-4 text-gray-600">
        <CodeBlock>{`# Install dependencies
pnpm install

# Build the vendored engine
pnpm --filter @promptowl/contextnest-engine build

# Copy .env.example and fill in values
cp .env.example .env.local

# Start the dev server
pnpm dev`}</CodeBlock>
        <p className="text-sm">
          The app runs at <InlineCode>http://localhost:3000</InlineCode>. The MCP endpoint
          is at <InlineCode>http://localhost:3000/api/mcp</InlineCode>.
        </p>
        <p className="text-sm">
          For local dev, use the filesystem storage backend by setting these in{' '}
          <InlineCode>.env.local</InlineCode>:
        </p>
        <CodeBlock>{`# Use a local vault directory instead of Vercel Blob
CONTEXTNEST_STORAGE=fs
CONTEXTNEST_VAULT_PATH=/path/to/your/vault

# Disable git sync
VAULT_SYNC_PROVIDER=none`}</CodeBlock>
        <div className="text-sm space-y-2">
          <p className="font-medium text-gray-700">Other useful commands</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {[
                  ['pnpm test', 'Run the test suite'],
                  ['pnpm test:watch', 'Run tests in watch mode'],
                  ['pnpm lint', 'Type-check without emitting'],
                  ['pnpm oauth:gen-keypair', 'Generate RS256 key pair for OAuth JWT signing'],
                  ['pnpm test:webhook', 'Send a test payload to the read.ai webhook'],
                ].map(([cmd, desc]) => (
                  <tr key={cmd} className="border-b border-gray-100">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-800 whitespace-nowrap">{cmd}</td>
                    <td className="py-2 text-gray-500 text-xs">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Section>
  );
}
