/**
 * Context Nest MCP tool registrations.
 *
 * Wraps the upstream @promptowl/contextnest-engine operations as MCP tools,
 * routing all storage through the Vercel Blob–backed NestStorage and
 * firing off Git sync commits for write operations.
 *
 * Each tool call gets its own VaultEngine instance via createEngine() so that
 * attribution (userToken) is correct per request.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  GraphQueryEngine,
  PackLoader,
  CheckpointManager,
  VersionManager,
  publishDocument,
  stageSuggestion,
  listSuggestions,
  approveSuggestion,
  rejectSuggestion,
  validateDocument,
  serializeDocument,
  parseUri,
} from '@promptowl/contextnest-engine';
import type { Frontmatter, RbacHook } from '@promptowl/contextnest-engine';
import { createEngine } from '@/lib/vault/index';
import type { McpExtra } from './auth';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function getExtra(authInfo: unknown): McpExtra {
  return (authInfo as { extra: McpExtra }).extra;
}

/**
 * Permissive RBAC for hosted single-tenant context — the actor identity is
 * already attested by the GitHub OAuth token. Real zone RBAC is enforced at
 * the Blob ACL and org-level; this stub lets the engine record the actor in
 * the audit trail without gating individual calls.
 */
const permissiveRbac: RbacHook = {
  isCzar: () => true,
  canIngest: () => true,
  isDocOwner: () => true,
};

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerTools(server: McpServer): void {
  const vaultIdParam = {
    vault_id: z.string().optional().describe('Vault ID for multi-repo support (defaults to CONTEXTNEST_DEFAULT_VAULT_ID or "default")'),
  };

  // ── vault_info ─────────────────────────────────────────────────────────────
  server.tool(
    'vault_info',
    'Get vault identity (CONTEXT.md) and configuration summary',
    { ...vaultIdParam },
    async ({ vault_id }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      const contextMd = await storage.readContextMd();
      const config = await storage.readConfig();
      return jsonResult({
        context_md: contextMd ?? '(no CONTEXT.md found)',
        config: config
          ? {
              name: config.name,
              description: config.description,
              servers: config.servers ? Object.keys(config.servers) : [],
            }
          : null,
      });
    },
  );

  // ── resolve ────────────────────────────────────────────────────────────────
  server.tool(
    'resolve',
    'Execute a selector query to find matching documents using graph traversal',
    {
      ...vaultIdParam,
      selector: z
        .string()
        .describe("Selector query expression (e.g., '#engineering + type:document')"),
      hops: z
        .number()
        .optional()
        .describe('Graph traversal depth (default: 2)'),
      full: z
        .boolean()
        .optional()
        .describe('Force full-load mode, bypassing graph traversal (default: false)'),
    },
    async ({ vault_id, selector, hops, full }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      const engine = new GraphQueryEngine(storage);
      const result = await engine.query(selector, {
        hops: hops ?? 2,
        full: full ?? false,
      });
      return jsonResult({
        documents: result.documents.map((d) => ({
          id: d.id,
          title: d.frontmatter.title,
          type: d.frontmatter.type ?? 'document',
          status: d.frontmatter.status ?? 'draft',
          tags: d.frontmatter.tags,
          body: d.body,
        })),
        source_nodes: result.sourceNodes.map((d) => ({
          id: d.id,
          title: d.frontmatter.title,
          source: d.frontmatter.source,
          body: d.body,
        })),
        traversal: {
          mode: result.mode,
          hops_used: result.hopsUsed,
          nodes_traversed: result.nodesTraversed,
        },
      });
    },
  );

  // ── read_document ──────────────────────────────────────────────────────────
  server.tool(
    'read_document',
    "Read a single document by its contextnest:// URI or path",
    {
      ...vaultIdParam,
      uri: z
        .string()
        .describe(
          "Document URI (e.g., 'contextnest://nodes/api-design') or path (e.g., 'nodes/api-design')",
        ),
    },
    async ({ vault_id, uri }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      let docId: string;
      if (uri.startsWith('contextnest://')) {
        const parsed = parseUri(uri);
        docId = parsed.path;
      } else {
        docId = uri.replace(/\.md$/, '');
      }
      const doc = await storage.readDocument(docId);
      return jsonResult({ id: doc.id, frontmatter: doc.frontmatter, body: doc.body });
    },
  );

  // ── list_documents ─────────────────────────────────────────────────────────
  server.tool(
    'list_documents',
    'List all documents with optional filters',
    {
      ...vaultIdParam,
      type: z.string().optional().describe('Filter by node type'),
      status: z.string().optional().describe('Filter by status (draft/published)'),
      tag: z.string().optional().describe('Filter by tag'),
    },
    async ({ vault_id, type, status, tag }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      let docs = await storage.discoverDocuments();
      if (type) docs = docs.filter((d) => (d.frontmatter.type ?? 'document') === type);
      if (status) docs = docs.filter((d) => (d.frontmatter.status ?? 'draft') === status);
      if (tag) {
        const normalizedTag = tag.startsWith('#') ? tag : `#${tag}`;
        docs = docs.filter((d) => d.frontmatter.tags?.includes(normalizedTag));
      }
      return jsonResult(
        docs.map((d) => ({
          id: d.id,
          title: d.frontmatter.title,
          type: d.frontmatter.type ?? 'document',
          status: d.frontmatter.status ?? 'draft',
          tags: d.frontmatter.tags,
        })),
      );
    },
  );

  // ── document_format ────────────────────────────────────────────────────────
  server.tool(
    'document_format',
    'Returns the markdown document format, supported frontmatter fields, validation rules, node types, and URI scheme. Call this before creating or updating documents to ensure correct structure.',
    {},
    async () => {
      const format = {
        structure: {
          description: 'Documents are markdown files with YAML frontmatter delimited by --- markers.',
          example: [
            '---',
            'title: My Document',
            'type: document',
            'status: draft',
            'tags:',
            "  - '#engineering'",
            '---',
            '',
            '# My Document',
            '',
            'Body content in GitHub Flavored Markdown.',
          ].join('\n'),
        },
        frontmatter_fields: {
          title: { required: true, type: 'string', constraints: '1–200 characters' },
          description: { required: false, type: 'string', constraints: '1–500 characters' },
          type: {
            required: false,
            type: 'string',
            default: 'document',
            values: [
              'document',
              'snippet',
              'glossary',
              'persona',
              'prompt',
              'source',
              'tool',
              'reference',
              'skill',
            ],
          },
          tags: {
            required: false,
            type: 'string[]',
            constraints:
              'Each tag must match: ^#?[a-zA-Z][a-zA-Z0-9_-]*$ — the # prefix is added automatically if omitted',
          },
          status: {
            required: false,
            type: 'string',
            default: 'draft',
            values: ['draft', 'published'],
          },
          version: {
            required: false,
            type: 'integer',
            constraints: '>= 1, managed automatically by publish',
          },
          author: { required: false, type: 'string' },
          created_at: { required: false, type: 'string', format: 'ISO 8601' },
          updated_at: { required: false, type: 'string', format: 'ISO 8601' },
          derived_from: {
            required: false,
            type: 'string[]',
            constraints: 'Array of contextnest:// URIs',
          },
          checksum: {
            required: false,
            type: 'string',
            format: 'sha256:<64 lowercase hex chars>, managed automatically',
          },
        },
        uri_scheme: {
          format: 'contextnest://<path>',
          examples: [
            { uri: 'contextnest://nodes/api-design', description: 'Reference a document' },
            { uri: 'contextnest://tag/engineering', description: 'Tag-based query' },
            { uri: 'contextnest://search/auth+flow', description: 'Full-text search' },
          ],
        },
      };
      return jsonResult(format);
    },
  );

  // ── read_index ─────────────────────────────────────────────────────────────
  server.tool('read_index', 'Return the context.yaml index', { ...vaultIdParam }, async ({ vault_id }, ctx) => {
    const extra = getExtra(ctx.authInfo);
    const { storage } = createEngine(extra.userToken, vault_id);
    const contextYaml = await storage.readContextYaml();
    return contextYaml
      ? jsonResult(contextYaml)
      : textResult("No context.yaml found. Run 'ctx index' to generate it.");
  });

  // ── read_pack ──────────────────────────────────────────────────────────────
  server.tool(
    'read_pack',
    'Resolve and return a context pack using graph traversal',
    {
      ...vaultIdParam,
      id: z.string().describe("Pack ID (e.g., 'onboarding.basics')"),
      hops: z.number().optional().describe('Graph traversal depth (default: 2)'),
    },
    async ({ vault_id, id, hops }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      const packs = await storage.readPacks();
      const packLoader = new PackLoader(packs);
      const pack = packLoader.get(id);
      if (!pack) {
        return textResult(`Pack "${id}" not found`);
      }
      const selector = pack.query ?? `pack:${id}`;
      const engine = new GraphQueryEngine(storage);
      const result = await engine.query(selector, { hops: hops ?? 2 });
      return jsonResult({
        pack: { id: pack.id, label: pack.label, description: pack.description },
        agent_instructions: pack.agent_instructions,
        documents: result.documents.map((d) => ({
          id: d.id,
          title: d.frontmatter.title,
          body: d.body,
        })),
        source_nodes: result.sourceNodes.map((d) => ({
          id: d.id,
          title: d.frontmatter.title,
          source: d.frontmatter.source,
          body: d.body,
        })),
        traversal: {
          mode: result.mode,
          hops_used: result.hopsUsed,
          nodes_traversed: result.nodesTraversed,
        },
      });
    },
  );

  // ── search ─────────────────────────────────────────────────────────────────
  server.tool(
    'search',
    'Full-text search across vault documents with graph traversal',
    {
      ...vaultIdParam,
      query: z.string().describe('Search query'),
      hops: z
        .number()
        .optional()
        .describe('Graph traversal depth from search results (default: 2)'),
      full: z
        .boolean()
        .optional()
        .describe('Force full-load mode for body-level search (default: false)'),
    },
    async ({ vault_id, query, hops, full }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      const selector = `contextnest://search/${query.replace(/\s+/g, '+')}`;
      const engine = new GraphQueryEngine(storage);
      const result = await engine.query(selector, {
        hops: hops ?? 2,
        full: full ?? false,
      });
      return jsonResult({
        documents: result.documents.map((d) => ({
          id: d.id,
          title: d.frontmatter.title,
          description: d.frontmatter.description,
          type: d.frontmatter.type ?? 'document',
          body: d.body,
        })),
        traversal: {
          mode: result.mode,
          hops_used: result.hopsUsed,
          nodes_traversed: result.nodesTraversed,
        },
      });
    },
  );

  // ── verify_integrity ───────────────────────────────────────────────────────
  server.tool(
    'verify_integrity',
    'Verify integrity of all hash chains in the vault',
    { ...vaultIdParam },
    async ({ vault_id }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      const report = await storage.verifyVaultIntegrity();
      return jsonResult(report);
    },
  );

  // ── list_checkpoints ───────────────────────────────────────────────────────
  server.tool(
    'list_checkpoints',
    'List recent checkpoints',
    { ...vaultIdParam, limit: z.number().optional().describe('Max checkpoints to return (default 10)') },
    async ({ vault_id, limit }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      const cm = new CheckpointManager(storage);
      const history = await cm.loadCheckpointHistory();
      if (!history) {
        return textResult('No checkpoints found.');
      }
      const n = limit ?? 10;
      const checkpoints = history.checkpoints.slice(-n);
      return jsonResult(checkpoints);
    },
  );

  // ── read_version ───────────────────────────────────────────────────────────
  server.tool(
    'read_version',
    'Read a specific version of a document',
    {
      ...vaultIdParam,
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      version: z.number().describe('Version number to reconstruct'),
    },
    async ({ vault_id, path, version }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      const id = path.replace(/\.md$/, '');
      const vm = new VersionManager(storage);
      const content = await vm.reconstructVersion(id, version);
      return textResult(content);
    },
  );

  // ── create_document ────────────────────────────────────────────────────────
  server.tool(
    'create_document',
    'Create a new document in the vault with frontmatter and optional body content',
    {
      ...vaultIdParam,
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      title: z.string().describe('Document title'),
      type: z
        .enum([
          'document',
          'snippet',
          'glossary',
          'persona',
          'prompt',
          'source',
          'tool',
          'reference',
          'skill',
        ])
        .optional()
        .default('document')
        .describe('Node type'),
      tags: z.array(z.string()).optional().describe('Tags for the document'),
      body: z.string().optional().default('').describe('Markdown body content'),
      trigger: z
        .string()
        .optional()
        .describe("Skill trigger description (required when type is 'skill')"),
      tools_required: z
        .array(z.string())
        .optional()
        .describe('Tools required for skill execution'),
      output_format: z
        .enum(['markdown', 'json', 'text', 'code'])
        .optional()
        .describe('Skill output format'),
    },
    async ({ vault_id, path, title, type, tags, body, trigger, tools_required, output_format }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage, sync, userToken } = createEngine(extra.userToken, vault_id);
      const id = path.replace(/\.md$/, '');

      // Check if document already exists
      try {
        await storage.readDocument(id);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Document "${id}" already exists` }),
            },
          ],
          isError: true,
        };
      } catch {
        // Document doesn't exist — proceed
      }

      const tagList = tags ? tags.map((t) => (t.startsWith('#') ? t : `#${t}`)) : undefined;
      const frontmatter: Frontmatter = {
        title,
        type,
        status: 'draft',
        created_at: new Date().toISOString(),
        ...(tagList ? { tags: tagList } : {}),
      };

      if (type === 'skill') {
        frontmatter.skill = {
          trigger: trigger ?? `when asked to ${title.toLowerCase()}`,
          inputs: [],
          tools_required: tools_required ?? [],
          output_format: output_format ?? 'markdown',
          guard_rails: [],
        };
      }

      const node = {
        id,
        filePath: '',
        frontmatter,
        body: body ? `\n${body}\n` : `\n# ${title}\n\n`,
        rawContent: '',
      };

      const content = serializeDocument(node);
      await storage.writeDocument(id, content);

      let result;
      try {
        result = await publishDocument(storage, id, {
          editedBy: extra.userLogin ?? 'mcp@contextnest.hosted',
          note: 'Created via MCP server',
        });
      } catch (err) {
        try {
          await storage.deleteDocument(id);
        } catch {
          // best-effort cleanup
        }
        throw err;
      }

      await storage.regenerateIndex();

      // Fire-and-forget Git sync
      sync
        .commitFile({
          path: `${id}.md`,
          content: Buffer.from(content, 'utf-8'),
          message: `create ${id}`,
          userToken,
        })
        .catch(console.error);

      return jsonResult({
        id: result.node.id,
        frontmatter: result.node.frontmatter,
        version: result.node.frontmatter.version,
        checkpoint: result.checkpointNumber,
        chain_hash: result.versionEntry.chain_hash,
        message: 'Document created and published successfully',
      });
    },
  );

  // ── update_document ────────────────────────────────────────────────────────
  server.tool(
    'update_document',
    "Update an existing document's frontmatter fields and/or body content",
    {
      ...vaultIdParam,
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      title: z.string().optional().describe('New title'),
      tags: z.array(z.string()).optional().describe('New tags (replaces existing)'),
      status: z.enum(['draft', 'published']).optional().describe('New status'),
      body: z.string().optional().describe('New markdown body content'),
    },
    async ({ vault_id, path, title, tags, status, body }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage, sync, userToken } = createEngine(extra.userToken, vault_id);
      const id = path.replace(/\.md$/, '');
      const doc = await storage.readDocument(id);

      if (title !== undefined) doc.frontmatter.title = title;
      if (status !== undefined) doc.frontmatter.status = status;
      if (tags !== undefined) {
        doc.frontmatter.tags = tags.map((t) => (t.startsWith('#') ? t : `#${t}`));
      }
      doc.frontmatter.updated_at = new Date().toISOString();
      if (body !== undefined) {
        doc.body = `\n${body}\n`;
      }

      const validation = validateDocument(doc);
      if (!validation.valid) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Validation failed', errors: validation.errors }, null, 2),
            },
          ],
          isError: true,
        };
      }

      const content = serializeDocument(doc);
      await storage.writeDocument(id, content);

      const result = await publishDocument(storage, id, {
        editedBy: extra.userLogin ?? 'mcp@contextnest.hosted',
        note: 'Updated via MCP server',
      });

      await storage.regenerateIndex();

      // Fire-and-forget Git sync
      sync
        .commitFile({
          path: `${id}.md`,
          content: Buffer.from(content, 'utf-8'),
          message: `update ${id}`,
          userToken,
        })
        .catch(console.error);

      return jsonResult({
        id: result.node.id,
        frontmatter: result.node.frontmatter,
        version: result.node.frontmatter.version,
        checkpoint: result.checkpointNumber,
        chain_hash: result.versionEntry.chain_hash,
        message: 'Document updated and published successfully',
      });
    },
  );

  // ── delete_document ────────────────────────────────────────────────────────
  server.tool(
    'delete_document',
    'Delete a document and its version history from the vault',
    { ...vaultIdParam, path: z.string().describe("Document path (e.g., 'nodes/api-design')") },
    async ({ vault_id, path }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage, sync, userToken } = createEngine(extra.userToken, vault_id);
      const id = path.replace(/\.md$/, '');
      const doc = await storage.readDocument(id);
      await storage.deleteDocument(id);
      await storage.regenerateIndex();

      // Fire-and-forget Git sync
      sync
        .deleteFile({
          path: `${id}.md`,
          message: `delete ${id}`,
          userToken,
        })
        .catch(console.error);

      return jsonResult({
        id,
        title: doc.frontmatter.title,
        message: 'Document deleted successfully',
      });
    },
  );

  // ── publish_document ───────────────────────────────────────────────────────
  server.tool(
    'publish_document',
    'Publish a document: bump version, compute checksum, create version entry and checkpoint',
    {
      ...vaultIdParam,
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      author: z
        .string()
        .optional()
        .default('mcp@contextnest.hosted')
        .describe('Author email'),
      note: z.string().optional().describe('Version note'),
    },
    async ({ vault_id, path, author, note }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage, sync, userToken } = createEngine(extra.userToken, vault_id);
      const id = path.replace(/\.md$/, '');

      const result = await publishDocument(storage, id, {
        editedBy: author,
        note,
      });

      await storage.regenerateIndex();

      // Fire-and-forget Git sync — sync the .md file as-is
      const buf = await storage.readDocument(id);
      sync
        .commitFile({
          path: `${id}.md`,
          content: Buffer.from(serializeDocument(buf), 'utf-8'),
          message: `publish ${id} v${result.node.frontmatter.version}`,
          userToken,
        })
        .catch(console.error);

      return jsonResult({
        id,
        version: result.node.frontmatter.version,
        checkpoint: result.checkpointNumber,
        chain_hash: result.versionEntry.chain_hash,
        message: 'Document published successfully',
      });
    },
  );

  // ── stage_drift_suggestion ─────────────────────────────────────────────────
  server.tool(
    'stage_drift_suggestion',
    'Capture an out-of-band edit (live file drifted from last-approved bytes) as a staged suggestion under _suggestions/. Does NOT modify the canonical document or hash chain.',
    {
      ...vaultIdParam,
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      actor: z
        .string()
        .optional()
        .describe("Opaque actor identity recorded in suggestion meta. Defaults to 'local-mcp'."),
      note: z.string().optional().describe('Optional human note explaining the drift'),
    },
    async ({ vault_id, path, actor, note }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      const id = path.replace(/\.md$/, '');
      const node = await storage.readDocument(id);
      const history = await storage.readHistory(id);

      if (!history || history.versions.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `No version history for "${id}" — nothing to compare against`,
              }),
            },
          ],
          isError: true,
        };
      }

      const latest = history.versions[history.versions.length - 1];
      const vm = new VersionManager(storage);
      const approvedRaw = await vm.reconstructVersion(id, latest.version);

      const docTier = node.frontmatter.governance ?? 'standard';
      const zone = node.frontmatter.zone;

      const result = await stageSuggestion({
        storage,
        documentId: id,
        approvedRawContent: approvedRaw,
        proposedRawContent: node.rawContent,
        source: 'out-of-band-edit',
        actor: actor ?? extra.userLogin ?? 'local-mcp',
        zone,
        docTier,
        note,
      });

      return jsonResult({
        suggestion_id: result.meta.suggestion_id,
        document_id: result.meta.document_id,
        doc_tier: result.meta.doc_tier,
        source: result.meta.source,
        target_hash: result.meta.target_hash,
        proposed_hash: result.meta.proposed_hash,
        detected_at: result.meta.detected_at,
        patch_path: result.patchPath,
        meta_path: result.metaPath,
        message: 'Drift staged. Use approve_suggestion or reject_suggestion to resolve.',
      });
    },
  );

  // ── list_suggestions ───────────────────────────────────────────────────────
  server.tool(
    'list_suggestions',
    'List all staged suggestions for a document',
    { ...vaultIdParam, path: z.string().describe("Document path (e.g., 'nodes/api-design')") },
    async ({ vault_id, path }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      const id = path.replace(/\.md$/, '');
      const metas = await listSuggestions(storage, id);
      return jsonResult({ document_id: id, count: metas.length, suggestions: metas });
    },
  );

  // ── approve_suggestion ─────────────────────────────────────────────────────
  server.tool(
    'approve_suggestion',
    'Approve a staged suggestion: applies the patch, bumps version, writes new canonical bytes, archives the suggestion under _archive/approved/.',
    {
      ...vaultIdParam,
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      suggestion_id: z
        .string()
        .describe('Suggestion ID from stage_drift_suggestion or list_suggestions'),
      actor: z
        .string()
        .optional()
        .describe("Actor identity recorded as approver. Defaults to 'local-mcp'."),
      comment: z
        .string()
        .optional()
        .describe('Optional approval comment recorded in the chain event'),
    },
    async ({ vault_id, path, suggestion_id, actor, comment }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage, sync, userToken } = createEngine(extra.userToken, vault_id);
      const id = path.replace(/\.md$/, '');
      const node = await storage.readDocument(id);
      const zone = node.frontmatter.zone ?? 'default';

      const result = await approveSuggestion({
        storage,
        rbac: permissiveRbac,
        documentId: id,
        actor: actor ?? extra.userLogin ?? 'local-mcp',
        zone,
        suggestionId: suggestion_id,
        comment,
      });

      await storage.regenerateIndex();

      // Fire-and-forget Git sync
      const updated = await storage.readDocument(id);
      sync
        .commitFile({
          path: `${id}.md`,
          content: Buffer.from(serializeDocument(updated), 'utf-8'),
          message: `approve suggestion ${suggestion_id} on ${id}`,
          userToken,
        })
        .catch(console.error);

      return jsonResult({
        document_id: id,
        version: result.versionEntry.version,
        chain_hash: result.versionEntry.chain_hash,
        chain_event_type: result.chainEvent.event_type,
        archived_at: result.archivedAt,
        message: 'Suggestion approved. New version published; canonical file updated.',
      });
    },
  );

  // ── reject_suggestion ──────────────────────────────────────────────────────
  server.tool(
    'reject_suggestion',
    'Reject a staged suggestion: archives the patch + meta under _archive/rejected/ and emits a chain event. Canonical document and hash chain head are untouched.',
    {
      ...vaultIdParam,
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      suggestion_id: z.string().describe('Suggestion ID to reject'),
      reason: z.string().describe('Rejection reason (required, non-empty)'),
      actor: z
        .string()
        .optional()
        .describe("Actor identity recorded as rejector. Defaults to 'local-mcp'."),
    },
    async ({ vault_id, path, suggestion_id, reason, actor }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, vault_id);
      const id = path.replace(/\.md$/, '');
      const node = await storage.readDocument(id);
      const zone = node.frontmatter.zone ?? 'default';

      const result = await rejectSuggestion({
        storage,
        rbac: permissiveRbac,
        documentId: id,
        actor: actor ?? extra.userLogin ?? 'local-mcp',
        zone,
        suggestionId: suggestion_id,
        reason,
      });

      return jsonResult({
        document_id: id,
        chain_event_type: result.chainEvent.event_type,
        archived_at: result.archivedAt,
        rejection_reason: reason,
        message: 'Suggestion rejected. Canonical document unchanged; patch archived.',
      });
    },
  );
}
