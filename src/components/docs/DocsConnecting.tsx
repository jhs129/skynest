import { Section, SubSection, CodeBlock, InlineCode } from './shared';

export function DocsConnecting() {
  return (
    <Section id="connect" title="Connecting your AI tool">
      <div className="space-y-6 text-gray-600">
        <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-4 space-y-1">
          <p className="text-sm font-medium text-indigo-800">Prerequisites</p>
          <ul className="text-sm text-indigo-700 space-y-1 list-disc list-inside">
            <li>A <strong>GitHub account</strong> — you&apos;ll be prompted to authorize on first connection.</li>
            <li><strong>Vault access</strong> — ask your Skynest admin to add your GitHub username as a collaborator on the vault repository.</li>
          </ul>
        </div>

        <p className="text-sm">
          Replace <InlineCode>YOUR_SKYNEST_URL</InlineCode> with your actual deployment URL in all examples below.
          To connect to a specific vault, append the vault ID to the URL:{' '}
          <InlineCode>https://YOUR_SKYNEST_URL/api/mcp/YOUR_VAULT_ID</InlineCode>.
          Omitting the vault ID uses the default vault configured on the server.
        </p>

        <SubSection title="Claude Code CLI">
          <CodeBlock>{`claude mcp add --transport http skynest https://YOUR_SKYNEST_URL/api/mcp`}</CodeBlock>
          <p className="text-sm">Restart Claude Code. On first use you&apos;ll be prompted to sign in with GitHub.</p>
          <details className="border border-gray-200 rounded-lg p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">Manual config alternative</summary>
            <div className="mt-3 space-y-2 text-sm text-gray-600">
              <p>Add to <InlineCode>~/.claude/mcp.json</InlineCode>:</p>
              <CodeBlock>{`{
  "mcpServers": {
    "skynest": {
      "type": "http",
      "url": "https://YOUR_SKYNEST_URL/api/mcp"
    }
  }
}`}</CodeBlock>
            </div>
          </details>
        </SubSection>

        <SubSection title="Claude Desktop App">
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 mb-3">
            <p className="text-sm text-amber-800">
              <strong>Admin setup required:</strong> Claude Desktop uses a web-based OAuth callback
              (<InlineCode>https://claude.ai/...</InlineCode>). Add{' '}
              <InlineCode>OAUTH_ALLOWED_REDIRECT_ORIGINS=https://claude.ai</InlineCode> to your
              Skynest deployment environment variables before connecting.
            </p>
          </div>
          <ol className="space-y-2 text-sm list-decimal list-inside">
            <li>Open the Claude Desktop app and go to <strong className="text-gray-800">Settings</strong>.</li>
            <li>Navigate to <strong className="text-gray-800">Integrations</strong> and click <strong className="text-gray-800">Add MCP Server</strong>.</li>
            <li>
              Enter:
              <div className="mt-2 ml-4">
                <CodeBlock>{`Name:      skynest
URL:       https://YOUR_SKYNEST_URL/api/mcp`}</CodeBlock>
              </div>
            </li>
            <li>Save. You&apos;ll be redirected to sign in with GitHub on first use.</li>
          </ol>
        </SubSection>

        <SubSection title="Claude Code App (Desktop)">
          <ol className="space-y-2 text-sm list-decimal list-inside">
            <li>Open Claude Code and go to <strong className="text-gray-800">Settings</strong>.</li>
            <li>Navigate to <strong className="text-gray-800">MCP Servers</strong> and click <strong className="text-gray-800">Add Server</strong>.</li>
            <li>
              Enter:
              <div className="mt-2 ml-4">
                <CodeBlock>{`Name:      skynest
Transport: HTTP
URL:       https://YOUR_SKYNEST_URL/api/mcp`}</CodeBlock>
              </div>
            </li>
            <li>Save and restart. You&apos;ll be prompted to sign in with GitHub on first use.</li>
          </ol>
        </SubSection>

        <SubSection title="Cursor">
          <p className="text-sm">Add to <InlineCode>.cursor/mcp.json</InlineCode> (or the global Cursor MCP config):</p>
          <CodeBlock>{`{
  "mcpServers": {
    "skynest": {
      "url": "https://YOUR_SKYNEST_URL/api/mcp",
      "transport": "http"
    }
  }
}`}</CodeBlock>
          <p className="text-sm">Reload Cursor. On first use, a browser window will open for GitHub OAuth sign-in.</p>
        </SubSection>

        <SubSection title="Other MCP-compatible tools">
          <p className="text-sm">
            Skynest exposes a standard MCP HTTP endpoint with OAuth 2.1. Any tool that supports
            MCP over HTTP with OAuth 2.1 should work — use{' '}
            <InlineCode>https://YOUR_SKYNEST_URL/api/mcp</InlineCode> as the endpoint (or{' '}
            <InlineCode>https://YOUR_SKYNEST_URL/api/mcp/YOUR_VAULT_ID</InlineCode> for a specific vault).
          </p>
        </SubSection>
      </div>
    </Section>
  );
}
