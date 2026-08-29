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
import { readSkillsConfig } from '@/lib/vault/skills-config';
import {
  HARNESSES,
  INSTALL_SCOPES,
  INSTALL_MODES,
  NotASkillNodeError,
  buildInstallManifest,
  renderSkill,
} from './skills';
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

function requireWriteScope(
  authInfo: unknown,
): { content: [{ type: 'text'; text: string }]; isError: true } | null {
  const scopes: string[] = (authInfo as { scopes?: string[] })?.scopes ?? [];
  if (!scopes.includes('mcp:write')) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error:
              'Insufficient permissions: this account has read-only access to this vault. Write access is required.',
          }),
        },
      ],
      isError: true,
    };
  }
  return null;
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

/**
 * The vault this call is addressing. Doubles as the default `server_alias`:
 * absent a client-side name, the vault id is the best guess at what the caller
 * configured this server as.
 */
function resolveVaultId(extra: McpExtra): string {
  return extra.vaultId ?? process.env.CONTEXTNEST_DEFAULT_VAULT_ID ?? 'default';
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true as const,
  };
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerTools(server: McpServer): void {
  // ── vault_info ─────────────────────────────────────────────────────────────
  server.tool(
    'vault_info',
    'Get vault identity (CONTEXT.md) and configuration summary',
    {},
    async (_args, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
      const contextMd = await storage.readContextMd();
      const config = await storage.readConfig();
      const skillsConfig = await readSkillsConfig(storage);
      return jsonResult({
        context_md: contextMd ?? '(no CONTEXT.md found)',
        config: config
          ? {
              name: config.name,
              description: config.description,
              servers: config.servers ? Object.keys(config.servers) : [],
            }
          : null,
        vault_id: resolveVaultId(extra),
        skills: {
          bootstrap: skillsConfig?.bootstrap ?? null,
          hint: skillsConfig?.bootstrap
            ? `This vault designates "${skillsConfig.bootstrap}" as its entry-point skill — how an agent is meant to work with this vault. Read it with get_skill({ path: "${skillsConfig.bootstrap}" }).`
            : 'This vault designates no entry-point skill. Set skills.bootstrap in .context/config.yaml, or browse what exists with list_documents({ type: "skill" }).',
        },
      });
    },
  );

  // ── resolve ────────────────────────────────────────────────────────────────
  server.tool(
    'resolve',
    'Execute a selector query to find matching documents using graph traversal',
    {
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
    async ({ selector, hops, full }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
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
      uri: z
        .string()
        .describe(
          "Document URI (e.g., 'contextnest://nodes/api-design') or path (e.g., 'nodes/api-design')",
        ),
    },
    async ({ uri }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
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
      type: z.string().optional().describe('Filter by node type'),
      status: z.string().optional().describe('Filter by status (draft/published)'),
      tag: z.string().optional().describe('Filter by tag'),
    },
    async ({ type, status, tag }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
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

  // ── get_skill ──────────────────────────────────────────────────────────────
  server.tool(
    'get_skill',
    "Render a type: skill node as a skill file for an agent harness. Returns harness-format frontmatter (for claude-code, `description` derived from the node's skill.trigger) plus the body. Find candidates with list_documents({ type: 'skill' }), or vault_info for this vault's designated entry-point skill.",
    {
      path: z
        .string()
        .describe("Skill node path (e.g., 'nodes/execution/skills/context-layer-maintenance')"),
      harness: z
        .enum(HARNESSES)
        .optional()
        .default('claude-code')
        .describe('Target agent harness. Controls frontmatter dialect and file location.'),
      server_alias: z
        .string()
        .optional()
        .describe(
          'The name THIS MCP server is configured as on your client — the middle segment of your tool names (mcp__<alias>__get_skill). Generated content uses it for tool references. Defaults to the vault id, which is often not what your client calls it.',
        ),
    },
    async ({ path, harness, server_alias }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
      const id = path.replace(/\.md$/, '');
      const vaultId = resolveVaultId(extra);
      const doc = await storage.readDocument(id);
      const config = await storage.readConfig();

      try {
        const rendered = renderSkill(doc, {
          harness,
          serverAlias: server_alias ?? vaultId,
          vaultId,
          vaultName: config?.name,
        });
        return jsonResult({
          name: rendered.name,
          description: rendered.description,
          harness,
          server_alias: server_alias ?? vaultId,
          source_path: id,
          version: doc.frontmatter.version ?? null,
          status: doc.frontmatter.status ?? 'draft',
          suggested_path: rendered.relativePath,
          content: rendered.content,
        });
      } catch (err) {
        if (err instanceof NotASkillNodeError) return errorResult(err.message);
        throw err;
      }
    },
  );

  // ── get_skill_install_manifest ─────────────────────────────────────────────
  server.tool(
    'get_skill_install_manifest',
    "Return the files needed to install a vault skill locally. THIS SERVER WRITES NOTHING — it is remote and has no filesystem access; you (the calling agent) write the returned files at their relative paths with your own file tools. Defaults to mode 'loader': the file carries the trigger and a fetch instruction back to the vault node, not the procedure, so it cannot drift. Use mode 'full' only when the vault will be unreachable at run time.",
    {
      path: z.string().describe("Skill node path (e.g., 'nodes/execution/skills/vault-bootstrap')"),
      harness: z.enum(HARNESSES).optional().default('claude-code').describe('Target agent harness'),
      scope: z
        .enum(INSTALL_SCOPES)
        .optional()
        .default('user')
        .describe(
          "'project' writes into the current repo (.claude/skills/…); 'user' writes into the home directory (~/.claude/skills/…)",
        ),
      server_alias: z
        .string()
        .optional()
        .describe(
          'The name THIS MCP server is configured as on your client — the middle segment of your tool names. The generated loader calls back through it, so a wrong value produces a skill that cannot fetch. Defaults to the vault id.',
        ),
      mode: z
        .enum(INSTALL_MODES)
        .optional()
        .default('loader')
        .describe(
          "'loader' (default) fetches the procedure from the vault at run time. 'full' inlines a snapshot that will go stale — a deliberate choice for offline use.",
        ),
    },
    async ({ path, harness, scope, server_alias, mode }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
      const id = path.replace(/\.md$/, '');
      const vaultId = resolveVaultId(extra);
      const doc = await storage.readDocument(id);
      const config = await storage.readConfig();

      try {
        return jsonResult(
          buildInstallManifest(doc, {
            harness,
            scope,
            mode,
            serverAlias: server_alias ?? vaultId,
            vaultId,
            vaultName: config?.name,
          }),
        );
      } catch (err) {
        if (err instanceof NotASkillNodeError) return errorResult(err.message);
        throw err;
      }
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
  server.tool('read_index', 'Return the context.yaml index', {}, async (_args, ctx) => {
    const extra = getExtra(ctx.authInfo);
    const { storage } = createEngine(extra.userToken, extra.vaultId);
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
      id: z.string().describe("Pack ID (e.g., 'onboarding.basics')"),
      hops: z.number().optional().describe('Graph traversal depth (default: 2)'),
    },
    async ({ id, hops }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
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
    async ({ query, hops, full }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
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
    {},
    async (_args, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
      const report = await storage.verifyVaultIntegrity();
      return jsonResult(report);
    },
  );

  // ── list_checkpoints ───────────────────────────────────────────────────────
  server.tool(
    'list_checkpoints',
    'List recent checkpoints',
    { limit: z.number().optional().describe('Max checkpoints to return (default 10)') },
    async ({ limit }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
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
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      version: z.number().describe('Version number to reconstruct'),
    },
    async ({ path, version }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
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
    async ({ path, title, type, tags, body, trigger, tools_required, output_format }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
      const { storage, sync, userToken } = createEngine(extra.userToken, extra.vaultId);
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

      // Git sync — errors propagate to the caller.
      // Commit the POST-publish bytes: `content` above is the pre-publish
      // serialization, still carrying status: draft and no version. Committing it
      // leaves the repo a faithful mirror of the body but not of publication
      // state, so anyone reading the repo concludes published nodes are drafts.
      await sync.commitFile({
        path: `${id}.md`,
        content: Buffer.from(serializeDocument(result.node), 'utf-8'),
        message: `create ${id}`,
        editedBy: extra.userLogin ?? 'mcp@contextnest.hosted',
        userToken,
      });

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
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      title: z.string().optional().describe('New title'),
      tags: z.array(z.string()).optional().describe('New tags (replaces existing)'),
      status: z.enum(['draft', 'published']).optional().describe('New status'),
      body: z.string().optional().describe('New markdown body content'),
    },
    async ({ path, title, tags, status, body }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
      const { storage, sync, userToken } = createEngine(extra.userToken, extra.vaultId);
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

      // Git sync — errors propagate to the caller.
      // Post-publish bytes, for the same reason as create_document: the
      // pre-publish `content` still carries the old version number.
      await sync.commitFile({
        path: `${id}.md`,
        content: Buffer.from(serializeDocument(result.node), 'utf-8'),
        message: `update ${id}`,
        editedBy: extra.userLogin ?? 'mcp@contextnest.hosted',
        userToken,
      });

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
    { path: z.string().describe("Document path (e.g., 'nodes/api-design')") },
    async ({ path }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
      const { storage, sync, userToken } = createEngine(extra.userToken, extra.vaultId);
      const id = path.replace(/\.md$/, '');
      const doc = await storage.readDocument(id);
      await storage.deleteDocument(id);
      await storage.regenerateIndex();

      // Git sync — errors propagate to the caller
      await sync.deleteFile({
        path: `${id}.md`,
        message: `delete ${id}`,
        editedBy: extra.userLogin ?? 'mcp@contextnest.hosted',
        userToken,
      });

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
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      author: z
        .string()
        .optional()
        .default('mcp@contextnest.hosted')
        .describe('Author email'),
      note: z.string().optional().describe('Version note'),
    },
    async ({ path, author, note }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
      const { storage, sync, userToken } = createEngine(extra.userToken, extra.vaultId);
      const id = path.replace(/\.md$/, '');

      const result = await publishDocument(storage, id, {
        editedBy: author,
        note,
      });

      await storage.regenerateIndex();

      // Git sync — errors propagate to the caller — sync the .md file as-is
      const buf = await storage.readDocument(id);
      await sync.commitFile({
        path: `${id}.md`,
        content: Buffer.from(serializeDocument(buf), 'utf-8'),
        message: `publish ${id} v${result.node.frontmatter.version}`,
        editedBy: extra.userLogin ?? 'mcp@contextnest.hosted',
        userToken,
      });

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
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      actor: z
        .string()
        .optional()
        .describe("Opaque actor identity recorded in suggestion meta. Defaults to 'local-mcp'."),
      note: z.string().optional().describe('Optional human note explaining the drift'),
    },
    async ({ path, actor, note }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
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
    { path: z.string().describe("Document path (e.g., 'nodes/api-design')") },
    async ({ path }, ctx) => {
      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
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
    async ({ path, suggestion_id, actor, comment }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
      const { storage, sync, userToken } = createEngine(extra.userToken, extra.vaultId);
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

      // Git sync — errors propagate to the caller
      const updated = await storage.readDocument(id);
      await sync.commitFile({
        path: `${id}.md`,
        content: Buffer.from(serializeDocument(updated), 'utf-8'),
        message: `approve suggestion ${suggestion_id} on ${id}`,
        editedBy: extra.userLogin ?? 'mcp@contextnest.hosted',
        userToken,
      });

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
      path: z.string().describe("Document path (e.g., 'nodes/api-design')"),
      suggestion_id: z.string().describe('Suggestion ID to reject'),
      reason: z.string().describe('Rejection reason (required, non-empty)'),
      actor: z
        .string()
        .optional()
        .describe("Actor identity recorded as rejector. Defaults to 'local-mcp'."),
    },
    async ({ path, suggestion_id, reason, actor }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
      const { storage } = createEngine(extra.userToken, extra.vaultId);
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
