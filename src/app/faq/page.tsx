import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'FAQ — Skynest',
  description: 'Prerequisites and setup instructions for connecting to Skynest.',
};

const SERVER_URL = 'https://YOUR_SKYNEST_URL/api/mcp';

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-gray-950 text-gray-100 rounded-lg p-4 overflow-x-auto text-sm">
      <code>{children}</code>
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900 border-b border-gray-200 pb-2">{title}</h2>
      {children}
    </section>
  );
}

export default function FaqPage() {
  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">FAQ</h1>
        <p className="text-gray-500">Prerequisites and setup instructions for connecting your AI tool to Skynest.</p>
      </div>

      <Section title="Prerequisites">
        <ul className="space-y-3 text-gray-600">
          <li className="flex gap-2">
            <span className="text-indigo-500 font-bold">✓</span>
            <span>
              <strong className="text-gray-800">GitHub account</strong> — Skynest uses GitHub OAuth for authentication.
              You&apos;ll be prompted to authorize during the first connection.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-indigo-500 font-bold">✓</span>
            <span>
              <strong className="text-gray-800">Vault access</strong> — Ask your Skynest admin to add your GitHub
              username as a collaborator on the vault repository.
            </span>
          </li>
        </ul>
      </Section>

      <Section title="Claude Code CLI">
        <p className="text-gray-600">
          Run the following command in your terminal to register the Skynest MCP server:
        </p>
        <CodeBlock>{`claude mcp add --transport http skynest ${SERVER_URL}`}</CodeBlock>
        <p className="text-gray-600">
          After adding, restart Claude Code and you&apos;ll be prompted to sign in with GitHub
          on first use.
        </p>
        <details className="border border-gray-200 rounded-lg p-4">
          <summary className="cursor-pointer font-medium text-gray-700">Manual config alternative</summary>
          <div className="mt-3 space-y-2 text-sm text-gray-600">
            <p>Add the following to your <code className="bg-gray-100 px-1 rounded">~/.claude/mcp.json</code>:</p>
            <CodeBlock>{`{
  "mcpServers": {
    "skynest": {
      "type": "http",
      "url": "${SERVER_URL}"
    }
  }
}`}</CodeBlock>
          </div>
        </details>
      </Section>

      <Section title="Claude Code App (Desktop)">
        <ol className="space-y-3 text-gray-600 list-decimal list-inside">
          <li>Open Claude Code and go to <strong className="text-gray-800">Settings</strong>.</li>
          <li>Navigate to <strong className="text-gray-800">MCP Servers</strong> and click <strong className="text-gray-800">Add Server</strong>.</li>
          <li>
            Enter the following details:
            <div className="mt-2 ml-4">
              <CodeBlock>{`Name:      skynest
Transport: HTTP
URL:       ${SERVER_URL}`}</CodeBlock>
            </div>
          </li>
          <li>Save and restart. You&apos;ll be prompted to sign in with GitHub on first use.</li>
        </ol>
      </Section>

      <Section title="Cursor">
        <p className="text-gray-600">
          Add the following to your project&apos;s <code className="bg-gray-100 px-1 rounded">.cursor/mcp.json</code>{' '}
          (or the global Cursor MCP config):
        </p>
        <CodeBlock>{`{
  "mcpServers": {
    "skynest": {
      "url": "${SERVER_URL}",
      "transport": "http"
    }
  }
}`}</CodeBlock>
        <p className="text-gray-600">
          Reload Cursor. On first use, a browser window will open for GitHub OAuth sign-in.
        </p>
      </Section>

      <Section title="Common questions">
        <div className="space-y-4">
          <details className="border border-gray-200 rounded-lg p-4">
            <summary className="cursor-pointer font-medium text-gray-700">
              I&apos;m getting an authentication error. What do I do?
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              Make sure you&apos;ve been added as a collaborator on the vault repository by your
              admin. If you&apos;re already a collaborator, try disconnecting and reconnecting the
              MCP server to trigger a fresh OAuth flow.
            </p>
          </details>
          <details className="border border-gray-200 rounded-lg p-4">
            <summary className="cursor-pointer font-medium text-gray-700">
              Can I use Skynest with other MCP-compatible tools?
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              Yes. Skynest exposes a standard MCP HTTP endpoint. Any tool that supports MCP
              over HTTP with OAuth 2.1 should work. Use the server URL{' '}
              <code className="bg-gray-100 px-1 rounded">{SERVER_URL}</code> as the endpoint.
            </p>
          </details>
        </div>
      </Section>
    </div>
  );
}
