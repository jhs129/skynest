import { Section, InlineCode } from './shared';

const READ_TOOLS = [
  { name: 'vault_info', description: 'Get vault identity (CONTEXT.md) and configuration summary' },
  { name: 'resolve', description: "Execute a selector query with graph traversal (e.g. '#engineering + type:document')" },
  { name: 'read_document', description: "Read a document by URI (contextnest://nodes/foo) or path (nodes/foo)" },
  { name: 'list_documents', description: 'List documents with optional type, status, and tag filters' },
  { name: 'document_format', description: 'Get the document format spec and frontmatter fields — call before creating docs' },
  { name: 'read_index', description: 'Return the context.yaml document graph index' },
  { name: 'read_pack', description: 'Resolve and return a context pack with documents and agent instructions' },
  { name: 'search', description: 'Full-text search across vault documents with graph traversal' },
  { name: 'verify_integrity', description: 'Verify all hash chains in the vault (tamper detection)' },
  { name: 'list_checkpoints', description: 'List recent vault checkpoints' },
  { name: 'read_version', description: 'Read a specific historical version of a document' },
];

const WRITE_TOOLS = [
  { name: 'create_document', description: 'Create a new document. Supports all node types including skill nodes.' },
  { name: 'update_document', description: "Update a document's title, tags, status, or body" },
  { name: 'delete_document', description: 'Delete a document and its version history' },
  { name: 'publish_document', description: 'Explicitly publish a document: bump version, compute checksum, create checkpoint' },
];

const GOVERNANCE_TOOLS = [
  { name: 'stage_drift_suggestion', description: 'Capture an out-of-band edit as a staged suggestion without modifying the canonical document' },
  { name: 'list_suggestions', description: 'List all staged suggestions for a document' },
  { name: 'approve_suggestion', description: 'Approve a suggestion: apply the patch, bump version, archive the suggestion' },
  { name: 'reject_suggestion', description: 'Reject a suggestion: archive without modifying the canonical document' },
];

function ToolTable({ tools }: { tools: { name: string; description: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <tbody>
          {tools.map((t) => (
            <tr key={t.name} className="border-b border-gray-100">
              <td className="py-2 pr-4 font-mono text-xs text-gray-800 whitespace-nowrap align-top pt-3">
                {t.name}
              </td>
              <td className="py-2 text-gray-500">{t.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocsMcpTools() {
  return (
    <Section id="tools" title="Available MCP tools">
      <div className="space-y-6 text-gray-600">
        <p className="text-sm">
          All tools from the upstream{' '}
          <a
            href="https://github.com/PromptOwl/ContextNest"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline"
          >
            Context Nest
          </a>{' '}
          MCP server are available over HTTPS. Write tools additionally commit each change to
          the vault&apos;s GitHub repository under the authenticated user&apos;s identity.
        </p>

        <div className="space-y-2">
          <h3 className="text-base font-medium text-gray-800">Read tools</h3>
          <ToolTable tools={READ_TOOLS} />
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-medium text-gray-800">
            Write tools{' '}
            <span className="text-xs font-normal text-gray-400 ml-1">
              — each write is committed to the vault repo under your GitHub identity
            </span>
          </h3>
          <ToolTable tools={WRITE_TOOLS} />
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-medium text-gray-800">Governance tools</h3>
          <p className="text-sm text-gray-500">
            Capture and resolve out-of-band edits through a review workflow without
            breaking the hash chain.
          </p>
          <ToolTable tools={GOVERNANCE_TOOLS} />
        </div>

        <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-600 space-y-2">
          <p className="font-medium text-gray-700">Selector syntax (used by <InlineCode>resolve</InlineCode>)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-xs">
            {[
              ['#tag', 'Documents with this tag'],
              ['#tag1 + #tag2', 'Must have both tags (AND)'],
              ['#tag1 | #tag2', 'Has either tag (OR)'],
              ['type:document', 'Filter by node type'],
              ['status:published', 'Filter by status'],
              ['pack:name', 'All documents in a pack'],
            ].map(([selector, desc]) => (
              <div key={selector} className="flex gap-2">
                <span className="text-indigo-700 shrink-0">{selector}</span>
                <span className="text-gray-400">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
