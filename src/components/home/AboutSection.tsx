export function AboutSection() {
  return (
    <section className="space-y-10">
      <h2 className="text-2xl font-semibold text-gray-900">What is Skynest?</h2>

      <div className="space-y-3">
        <h3 className="text-lg font-medium text-gray-800">Built on Context Nest</h3>
        <p className="text-gray-600 leading-relaxed">
          <a
            href="https://github.com/PromptOwl/ContextNest"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline"
          >
            Context Nest
          </a>{' '}
          (by{' '}
          <a
            href="https://promptowl.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline"
          >
            PromptOwl
          </a>
          ) is a structured knowledge vault for AI tools. Rather than dumping raw files at
          an AI, it organizes information as interconnected documents — nodes with graph
          relationships, pack bundles, semantic indexing, and full version history —
          purpose-built for AI consumption. Teams use it to share meeting notes, project
          decisions, architectural context, and reference documentation directly with Claude,
          Cursor, and other AI tools through the Model Context Protocol (MCP).
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-medium text-gray-800">The limitation: it&apos;s tied to your machine</h3>
        <p className="text-gray-600 leading-relaxed">
          The original Context Nest runs as a local stdio MCP server with vault files on
          your filesystem. That means it only works when your machine is on and the server
          process is running. Sharing the vault via OneDrive or Dropbox can extend access to
          teammates, but requires every person to have the right drive mapped and synced —
          and there&apos;s no built-in multi-user story. Writes from different people can
          conflict silently, and nothing links a document change to the person who made it.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-medium text-gray-800">What Skynest adds: cloud deployment</h3>
        <p className="text-gray-600 leading-relaxed">
          Skynest adapts Context Nest for serverless cloud deployment on Vercel. It replaces
          the local filesystem with{' '}
          <strong className="text-gray-800">Vercel Blob</strong> — durable, globally
          accessible object storage — so vault documents are always available without any
          local process running. Authentication is handled by{' '}
          <strong className="text-gray-800">GitHub OAuth 2.1</strong>: every team member
          signs in with their own GitHub account, and every write is committed to a private
          GitHub repository under that user&apos;s identity. You get a complete, accurate
          audit trail of who wrote what and when, using real git commits — not a synthetic
          log.
        </p>
        <p className="text-gray-600 leading-relaxed">
          All 18+ Context Nest MCP tools — <code className="bg-gray-100 px-1 rounded text-sm">read_document</code>,{' '}
          <code className="bg-gray-100 px-1 rounded text-sm">search</code>,{' '}
          <code className="bg-gray-100 px-1 rounded text-sm">create_document</code>,{' '}
          <code className="bg-gray-100 px-1 rounded text-sm">update_document</code>,{' '}
          <code className="bg-gray-100 px-1 rounded text-sm">read_version</code>, integrity checks, and more —
          are exposed over HTTPS. Connect once from Claude Code, Cursor, or any
          MCP-compatible AI tool, and your team&apos;s entire knowledge vault is immediately
          accessible from any machine, any time.
        </p>
      </div>

      <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-6 space-y-2">
        <p className="text-sm font-medium text-indigo-800">
          Skynest is built on the open-source Context Nest engine by PromptOwl (AGPL-3.0).
          The vault storage layer has been adapted to run on Vercel&apos;s serverless
          infrastructure, with GitHub OAuth and Vercel Blob replacing the local filesystem.
        </p>
      </div>
    </section>
  );
}
