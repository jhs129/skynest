import { Section, InlineCode } from './shared';

export function DocsOverview() {
  return (
    <Section id="overview" title="What is Skynest?">
      <div className="space-y-4 text-gray-600">
        <p className="leading-relaxed">
          Skynest is a hosted{' '}
          <a
            href="https://github.com/PromptOwl/ContextNest"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline"
          >
            Context Nest
          </a>{' '}
          MCP server. Context Nest (by{' '}
          <a
            href="https://promptowl.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline"
          >
            PromptOwl
          </a>
          ) organizes knowledge as interconnected typed documents — nodes with graph
          relationships, pack bundles, semantic indexing, and full version history — purpose-built
          for AI consumption via the{' '}
          <strong className="text-gray-800">Model Context Protocol (MCP)</strong>.
        </p>
        <p className="leading-relaxed">
          The upstream project runs as a local stdio MCP server tied to one machine. Skynest
          lifts this to the cloud: vault files live in{' '}
          <strong className="text-gray-800">Vercel Blob</strong>, every team member
          authenticates with their own{' '}
          <strong className="text-gray-800">GitHub account via OAuth 2.1</strong>, and every
          write is committed to a private git repository under that user&apos;s identity — a
          tamper-evident audit trail at no extra effort.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {[
            { title: 'Always on', body: 'Vault is reachable over HTTPS 24/7 — not just when your Mac is open.' },
            { title: 'Multi-user', body: 'Each teammate signs in with their own GitHub account. Writes are attributed in git.' },
            { title: 'Git-versioned', body: 'Every document change is a real commit — full history, diffs, and rollback.' },
            { title: 'read.ai integration', body: 'Meeting transcripts are ingested automatically when a meeting ends.' },
          ].map((f) => (
            <div key={f.title} className="rounded-lg border border-gray-200 p-4 space-y-1">
              <div className="font-medium text-gray-900 text-sm">{f.title}</div>
              <div className="text-sm text-gray-500">{f.body}</div>
            </div>
          ))}
        </div>
        <p className="text-sm text-gray-500 pt-2">
          Skynest exposes 19 Context Nest MCP tools —{' '}
          <InlineCode>read_document</InlineCode>, <InlineCode>search</InlineCode>,{' '}
          <InlineCode>create_document</InlineCode>, <InlineCode>update_document</InlineCode>,{' '}
          <InlineCode>verify_integrity</InlineCode>, governance tools, and more — over a
          standard HTTPS endpoint compatible with Claude Code, Cursor, and any MCP-capable AI
          tool.
        </p>
      </div>
    </Section>
  );
}
