/**
 * Unit tests for MCP tool registrations.
 *
 * Strategy:
 *  - Mock createEngine (vault layer) and @promptowl/contextnest-engine (engine functions)
 *  - Capture registered handlers via McpServer.tool() mock
 *  - Call each handler directly with fake args and ctx
 *  - Assert storage / engine methods were called and result shape is correct
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock: vault engine ──────────────────────────────────────────────────────

const mockStorage = {
  readContextMd: vi.fn(),
  readConfig: vi.fn(),
  readDocument: vi.fn(),
  writeDocument: vi.fn(),
  deleteDocument: vi.fn(),
  discoverDocuments: vi.fn(),
  readContextYaml: vi.fn(),
  readPacks: vi.fn(),
  verifyVaultIntegrity: vi.fn(),
  readHistory: vi.fn(),
  regenerateIndex: vi.fn(),
  provider: { read: vi.fn() },
};

const mockSync = {
  commitFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
};

const mockEngine = {
  storage: mockStorage,
  sync: mockSync,
  userToken: 'ghp_test',
};

vi.mock('@/lib/vault/index', () => ({
  createEngine: vi.fn(() => mockEngine),
}));

// ── Mock: @promptowl/contextnest-engine ─────────────────────────────────────

const mockGqeQuery = vi.fn();
const mockPackGet = vi.fn();
const mockLoadCheckpointHistory = vi.fn();
const mockReconstructVersion = vi.fn();

vi.mock('@promptowl/contextnest-engine', () => {
  return {
    GraphQueryEngine: vi.fn().mockImplementation(() => ({ query: mockGqeQuery })),
    PackLoader: vi.fn().mockImplementation(() => ({ get: mockPackGet })),
    CheckpointManager: vi.fn().mockImplementation(() => ({
      loadCheckpointHistory: mockLoadCheckpointHistory,
    })),
    VersionManager: vi.fn().mockImplementation(() => ({
      reconstructVersion: mockReconstructVersion,
    })),
    publishDocument: vi.fn(),
    stageSuggestion: vi.fn(),
    listSuggestions: vi.fn(),
    approveSuggestion: vi.fn(),
    rejectSuggestion: vi.fn(),
    validateDocument: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    serializeDocument: vi.fn().mockReturnValue('---\ntitle: Test\n---\n\nBody\n'),
    parseUri: vi.fn().mockImplementation((uri: string) => ({ path: uri.replace('contextnest://', '') })),
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A minimal McpServer stub that captures registered tools so tests can call them.
 */
type ToolHandler = (args: unknown, ctx: unknown) => Promise<unknown>;

interface RegisteredTool {
  description: string;
  schema: unknown;
  handler: ToolHandler;
}

function makeServerStub() {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool: vi.fn(
      (
        name: string,
        config: { description: string; inputSchema: unknown },
        handler: ToolHandler,
      ) => {
        tools.set(name, { description: config.description, schema: config.inputSchema, handler });
      },
    ),
  };
  return { server, tools };
}

function makeCtx(userToken = 'ghp_test', userLogin = 'testuser', scopes = ['mcp:read', 'mcp:write']) {
  return { authInfo: { extra: { userToken, userLogin }, scopes } };
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: commitFile / deleteFile are fire-and-forget, so resolve silently
  mockSync.commitFile.mockResolvedValue(undefined);
  mockSync.deleteFile.mockResolvedValue(undefined);
  mockStorage.regenerateIndex.mockResolvedValue(undefined);
  mockStorage.provider.read.mockResolvedValue(null);
});

/** Register the tools against a fresh stub server and hand back the tool map. */
async function loadTools() {
  const { server, tools } = makeServerStub();
  const { registerTools } = await import('./tools.js');
  // @ts-expect-error — stub satisfies the shape needed by registerTools
  registerTools(server);
  return tools;
}

/** Invoke a tool and return its raw text payload plus the error flag. */
async function call(toolName: string, args: unknown, ctx = makeCtx()) {
  const tools = await loadTools();
  const tool = tools.get(toolName);
  expect(tool, `tool "${toolName}" is not registered`).toBeDefined();
  const result = (await tool!.handler(args, ctx)) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { raw: result.content[0].text, isError: result.isError === true };
}

/** Invoke a tool and parse its JSON payload. */
async function callJson(toolName: string, args: unknown, ctx = makeCtx()) {
  const { raw, isError } = await call(toolName, args, ctx);
  return { data: JSON.parse(raw), isError };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerTools', () => {
  describe('write-scope enforcement', () => {
    const WRITE_TOOLS = [
      { name: 'create_document', args: { path: 'nodes/new-doc', title: 'New Doc', type: 'document', body: 'Hello' } },
      { name: 'update_document', args: { path: 'nodes/existing' } },
      { name: 'delete_document', args: { path: 'nodes/existing' } },
      { name: 'publish_document', args: { path: 'nodes/existing' } },
      { name: 'stage_drift_suggestion', args: { path: 'nodes/existing' } },
      { name: 'approve_suggestion', args: { path: 'nodes/existing', suggestion_id: 'sugg-1' } },
      { name: 'reject_suggestion', args: { path: 'nodes/existing', suggestion_id: 'sugg-1', reason: 'no' } },
    ];

    it.each(WRITE_TOOLS)('$name rejects a read-only token before touching storage', async ({ name, args }) => {
      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get(name);
      const result = (await tool!.handler(args, makeCtx('ghp_test', 'testuser', ['mcp:read']))) as {
        content: { text: string }[];
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/Insufficient permissions/);
      expect(mockStorage.readDocument).not.toHaveBeenCalled();
      expect(mockStorage.writeDocument).not.toHaveBeenCalled();
      expect(mockStorage.deleteDocument).not.toHaveBeenCalled();
    });
  });

  describe('vault_info (read tool)', () => {
    it('calls readContextMd and readConfig and returns their data', async () => {
      mockStorage.readContextMd.mockResolvedValue('# My Vault');
      mockStorage.readConfig.mockResolvedValue({ name: 'Test Vault', description: 'A vault', servers: { github: {} } });

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub satisfies the shape needed by registerTools
      registerTools(server);

      const tool = tools.get('vault_info');
      expect(tool).toBeDefined();

      const result = (await tool!.handler({}, makeCtx())) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0].text);

      expect(mockStorage.readContextMd).toHaveBeenCalledOnce();
      expect(mockStorage.readConfig).toHaveBeenCalledOnce();
      expect(data.context_md).toBe('# My Vault');
      expect(data.config.name).toBe('Test Vault');
      expect(data.config.servers).toContain('github');
    });

    it('handles missing CONTEXT.md gracefully', async () => {
      mockStorage.readContextMd.mockResolvedValue(null);
      mockStorage.readConfig.mockResolvedValue(null);

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('vault_info');
      const result = (await tool!.handler({}, makeCtx())) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0].text);

      expect(data.context_md).toBe('(no CONTEXT.md found)');
      expect(data.config).toBeNull();
    });

    it('names the designated bootstrap skill when the vault configures one', async () => {
      mockStorage.readContextMd.mockResolvedValue('# My Vault');
      mockStorage.readConfig.mockResolvedValue({ name: 'Test Vault' });
      mockStorage.provider.read.mockResolvedValue(
        Buffer.from('version: 1\nname: Test Vault\nskills:\n  bootstrap: nodes/skills/vault-bootstrap\n'),
      );

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const result = (await tools.get('vault_info')!.handler({}, makeCtx())) as {
        content: { text: string }[];
      };
      const data = JSON.parse(result.content[0].text);

      expect(data.skills.bootstrap).toBe('nodes/skills/vault-bootstrap');
      expect(data.skills.hint).toContain('nodes/skills/vault-bootstrap');
    });

    it('reports no bootstrap skill when the vault configures none', async () => {
      mockStorage.readContextMd.mockResolvedValue('# My Vault');
      mockStorage.readConfig.mockResolvedValue({ name: 'Test Vault' });
      mockStorage.provider.read.mockResolvedValue(Buffer.from('version: 1\nname: Test Vault\n'));

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const result = (await tools.get('vault_info')!.handler({}, makeCtx())) as {
        content: { text: string }[];
      };
      const data = JSON.parse(result.content[0].text);

      expect(data.skills.bootstrap).toBeNull();
    });
  });

  describe('get_skill / get_skill_install_manifest (read tools)', () => {
    const SKILL_DOC = {
      id: 'nodes/skills/vault-bootstrap',
      frontmatter: {
        title: 'Vault Bootstrap',
        type: 'skill',
        status: 'published',
        version: 3,
        skill: {
          trigger: 'Use when first connecting to this vault',
          tools_required: ['read_document'],
          guard_rails: ['Never invent node paths'],
          output_format: 'markdown',
        },
      },
      body: '\n1. Call {{server_alias}} vault_info.\n',
    };

    it('renders claude-code frontmatter whose description comes from skill.trigger', async () => {
      mockStorage.readDocument.mockResolvedValue(SKILL_DOC);
      mockStorage.readConfig.mockResolvedValue({ name: 'Test Vault' });
      const tools = await loadTools();

      const result = (await tools.get('get_skill')!.handler(
        { path: 'nodes/skills/vault-bootstrap.md', harness: 'claude-code', server_alias: 'ctx' },
        makeCtx(),
      )) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0].text);

      expect(mockStorage.readDocument).toHaveBeenCalledWith('nodes/skills/vault-bootstrap');
      expect(data.name).toBe('vault-bootstrap');
      expect(data.description).toBe('Use when first connecting to this vault');
      expect(data.content).toContain('name: vault-bootstrap');
      expect(data.content).toContain('description: "Use when first connecting to this vault"');
      expect(data.content).toContain('mcp__ctx__read_document');
      expect(data.content).not.toContain('mcp__skynest__');
      expect(data.content).toContain('1. Call ctx vault_info.');
    });

    it('errors clearly on a non-skill node', async () => {
      mockStorage.readDocument.mockResolvedValue({
        id: 'nodes/api-design',
        frontmatter: { title: 'API Design', type: 'document' },
        body: 'hi',
      });
      mockStorage.readConfig.mockResolvedValue(null);
      const tools = await loadTools();

      const result = (await tools.get('get_skill')!.handler(
        { path: 'nodes/api-design', harness: 'claude-code' },
        makeCtx(),
      )) as { content: { text: string }[]; isError: boolean };

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/not "skill"/);
    });

    it('defaults to loader mode and emits a file that fetches the node at run time', async () => {
      mockStorage.readDocument.mockResolvedValue(SKILL_DOC);
      mockStorage.readConfig.mockResolvedValue({ name: 'Test Vault' });
      const tools = await loadTools();

      const result = (await tools.get('get_skill_install_manifest')!.handler(
        { path: 'nodes/skills/vault-bootstrap', harness: 'claude-code', scope: 'user', mode: 'loader' },
        makeCtx(),
      )) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0].text);

      expect(data.skill.mode).toBe('loader');
      expect(data.files).toHaveLength(1);
      expect(data.files[0].relative_path).toBe('~/.claude/skills/vault-bootstrap/SKILL.md');
      expect(data.files[0].content).toContain('get_skill({ path: "nodes/skills/vault-bootstrap"');
      // The loader must NOT carry the procedure itself.
      expect(data.files[0].content).not.toContain('Call ctx vault_info');
      expect(data.notes).toMatch(/calling agent\) write these files/);
    });

    it('defaults server_alias to the vault id when the caller gives none', async () => {
      mockStorage.readDocument.mockResolvedValue(SKILL_DOC);
      mockStorage.readConfig.mockResolvedValue(null);
      const tools = await loadTools();

      const result = (await tools.get('get_skill_install_manifest')!.handler(
        { path: 'nodes/skills/vault-bootstrap', harness: 'claude-code', scope: 'project', mode: 'loader' },
        { authInfo: { extra: { userToken: 't', userLogin: 'u', vaultId: 'bigearnie-ctx' }, scopes: ['mcp:read'] } },
      )) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0].text);

      expect(data.skill.server_alias).toBe('bigearnie-ctx');
      expect(data.files[0].relative_path).toBe('.claude/skills/vault-bootstrap/SKILL.md');
      expect(data.files[0].content).toContain('mcp__bigearnie-ctx__get_skill');
    });
  });

  describe('read_document (read tool)', () => {
    it('calls readDocument with the correct id stripped of .md extension', async () => {
      mockStorage.readDocument.mockResolvedValue({
        id: 'nodes/api-design',
        frontmatter: { title: 'API Design', type: 'document', status: 'published' },
        body: '\n# API Design\n',
      });

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('read_document');
      const result = (await tool!.handler({ uri: 'nodes/api-design.md' }, makeCtx())) as {
        content: { text: string }[];
      };
      const data = JSON.parse(result.content[0].text);

      expect(mockStorage.readDocument).toHaveBeenCalledWith('nodes/api-design');
      expect(data.id).toBe('nodes/api-design');
      expect(data.frontmatter.title).toBe('API Design');
    });

    it('parses contextnest:// URIs via parseUri', async () => {
      const { parseUri } = await import('@promptowl/contextnest-engine');
      vi.mocked(parseUri).mockReturnValue({ path: 'nodes/api-design', kind: 'document' });

      mockStorage.readDocument.mockResolvedValue({
        id: 'nodes/api-design',
        frontmatter: { title: 'API Design' },
        body: '',
      });

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('read_document');
      await tool!.handler({ uri: 'contextnest://nodes/api-design' }, makeCtx());

      expect(parseUri).toHaveBeenCalledWith('contextnest://nodes/api-design');
      expect(mockStorage.readDocument).toHaveBeenCalledWith('nodes/api-design');
    });
  });

  describe('list_documents (read tool)', () => {
    it('returns all documents when no filters are provided', async () => {
      mockStorage.discoverDocuments.mockResolvedValue([
        { id: 'nodes/a', frontmatter: { title: 'A', type: 'document', status: 'draft', tags: ['#eng'] }, body: '' },
        { id: 'nodes/b', frontmatter: { title: 'B', type: 'snippet', status: 'published', tags: [] }, body: '' },
      ]);

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('list_documents');
      const result = (await tool!.handler({}, makeCtx())) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0].text);

      expect(data).toHaveLength(2);
    });

    it('filters by type when provided', async () => {
      mockStorage.discoverDocuments.mockResolvedValue([
        { id: 'nodes/a', frontmatter: { title: 'A', type: 'document', status: 'draft' }, body: '' },
        { id: 'nodes/b', frontmatter: { title: 'B', type: 'snippet', status: 'draft' }, body: '' },
      ]);

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('list_documents');
      const result = (await tool!.handler({ type: 'snippet' }, makeCtx())) as {
        content: { text: string }[];
      };
      const data = JSON.parse(result.content[0].text);

      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('nodes/b');
    });
  });

  describe('create_document (write tool)', () => {
    it('writes the document and fires commitFile', async () => {
      // First call throws (doc doesn't exist), write succeeds
      mockStorage.readDocument
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValue({
          id: 'nodes/new-doc',
          frontmatter: { title: 'New Doc', type: 'document', status: 'published', version: 1 },
          body: '',
          rawContent: '',
        });
      mockStorage.writeDocument.mockResolvedValue(undefined);

      const { publishDocument } = await import('@promptowl/contextnest-engine');
      vi.mocked(publishDocument).mockResolvedValue({
        node: {
          id: 'nodes/new-doc',
          frontmatter: { title: 'New Doc', type: 'document', status: 'published', version: 1 },
          body: '',
          filePath: '',
          rawContent: '',
        },
        checkpointNumber: 1,
        versionEntry: { chain_hash: 'abc123', version: 1, content_hash: 'def456', edited_by: 'test', keyframe: true, edited_at: '2024-01-01T00:00:00.000Z' },
      } as ReturnType<typeof publishDocument> extends Promise<infer T> ? T : never);

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('create_document');
      const result = (await tool!.handler(
        { path: 'nodes/new-doc', title: 'New Doc', type: 'document', body: 'Hello' },
        makeCtx(),
      )) as { content: { text: string }[] };

      const data = JSON.parse(result.content[0].text);
      expect(data.message).toBe('Document created and published successfully');
      expect(mockStorage.writeDocument).toHaveBeenCalledWith('nodes/new-doc', expect.any(String));
      expect(publishDocument).toHaveBeenCalledWith(mockStorage, 'nodes/new-doc', expect.objectContaining({ editedBy: 'testuser' }));
      expect(mockStorage.regenerateIndex).toHaveBeenCalledOnce();
      // sync is fire-and-forget; check it was called
      expect(mockSync.commitFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'nodes/new-doc.md', message: 'create nodes/new-doc' }),
      );
    });

    it('returns an error when the document already exists', async () => {
      mockStorage.readDocument.mockResolvedValue({
        id: 'nodes/existing',
        frontmatter: { title: 'Existing' },
        body: '',
      });

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('create_document');
      const result = (await tool!.handler(
        { path: 'nodes/existing', title: 'Existing' },
        makeCtx(),
      )) as { content: { text: string }[]; isError: boolean };

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/already exists/);
    });
  });

  describe('delete_document (write tool)', () => {
    it('calls deleteDocument and fires deleteFile', async () => {
      mockStorage.readDocument.mockResolvedValue({
        id: 'nodes/old-doc',
        frontmatter: { title: 'Old Doc' },
        body: '',
      });
      mockStorage.deleteDocument.mockResolvedValue(undefined);

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('delete_document');
      const result = (await tool!.handler({ path: 'nodes/old-doc' }, makeCtx())) as {
        content: { text: string }[];
      };
      const data = JSON.parse(result.content[0].text);

      expect(data.message).toBe('Document deleted successfully');
      expect(mockStorage.deleteDocument).toHaveBeenCalledWith('nodes/old-doc');
      expect(mockStorage.regenerateIndex).toHaveBeenCalledOnce();
      expect(mockSync.deleteFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'nodes/old-doc.md', message: 'delete nodes/old-doc' }),
      );
    });
  });

  describe('verify_integrity (stateless tool)', () => {
    it('returns the verification report from verifyVaultIntegrity', async () => {
      mockStorage.verifyVaultIntegrity.mockResolvedValue({ valid: true, errors: [] });

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('verify_integrity');
      const result = (await tool!.handler({}, makeCtx())) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0].text);

      expect(data.valid).toBe(true);
      expect(data.errors).toHaveLength(0);
    });
  });

  describe('document_format (stateless tool)', () => {
    it('returns format metadata without calling storage', async () => {
      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('document_format');
      const result = (await tool!.handler({}, makeCtx())) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0].text);

      expect(data).toHaveProperty('structure');
      expect(data).toHaveProperty('frontmatter_fields');
      expect(data).toHaveProperty('uri_scheme');
      expect(mockStorage.readDocument).not.toHaveBeenCalled();
    });
  });

  describe('read_index', () => {
    it('returns context.yaml content when present', async () => {
      mockStorage.readContextYaml.mockResolvedValue({ version: 1, documents: [] });

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('read_index');
      const result = (await tool!.handler({}, makeCtx())) as { content: { text: string }[] };
      const data = JSON.parse(result.content[0].text);

      expect(data).toHaveProperty('version', 1);
    });

    it('returns fallback text when context.yaml is missing', async () => {
      mockStorage.readContextYaml.mockResolvedValue(null);

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('read_index');
      const result = (await tool!.handler({}, makeCtx())) as { content: { text: string }[] };

      expect(result.content[0].text).toContain("No context.yaml found");
    });
  });

  describe('list_suggestions (read tool)', () => {
    it('calls listSuggestions with the correct document id', async () => {
      const { listSuggestions } = await import('@promptowl/contextnest-engine');
      vi.mocked(listSuggestions).mockResolvedValue([
        { suggestion_id: 'sug-001', document_id: 'nodes/doc', doc_tier: 'standard', source: 'out-of-band-edit', target_hash: 'h1', proposed_hash: 'h2', detected_at: '2024-01-01T00:00:00Z' },
      ] as Awaited<ReturnType<typeof listSuggestions>>);

      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get('list_suggestions');
      const result = (await tool!.handler({ path: 'nodes/doc' }, makeCtx())) as {
        content: { text: string }[];
      };
      const data = JSON.parse(result.content[0].text);

      expect(listSuggestions).toHaveBeenCalledWith(mockStorage, 'nodes/doc');
      expect(data.count).toBe(1);
      expect(data.document_id).toBe('nodes/doc');
    });
  });

  describe('resolve (read tool)', () => {
    it('passes the selector through and defaults to 2 hops', async () => {
      mockGqeQuery.mockResolvedValue({
        documents: [
          {
            id: 'nodes/a',
            frontmatter: { title: 'A', type: 'document', status: 'published', tags: ['#eng'] },
            body: 'body-a',
          },
        ],
        sourceNodes: [],
        mode: 'graph',
        hopsUsed: 2,
        nodesTraversed: 7,
      });

      const { data } = await callJson('resolve', { selector: '#eng + type:document' });

      expect(mockGqeQuery).toHaveBeenCalledWith('#eng + type:document', { hops: 2, full: false });
      expect(data.documents[0]).toMatchObject({ id: 'nodes/a', title: 'A', tags: ['#eng'] });
      expect(data.traversal).toMatchObject({ mode: 'graph', hops_used: 2, nodes_traversed: 7 });
    });

    it('honours explicit hops and full-load mode', async () => {
      mockGqeQuery.mockResolvedValue({
        documents: [],
        sourceNodes: [],
        mode: 'full',
        hopsUsed: 0,
        nodesTraversed: 0,
      });

      await callJson('resolve', { selector: '#eng', hops: 3, full: true });

      expect(mockGqeQuery).toHaveBeenCalledWith('#eng', { hops: 3, full: true });
    });

    it('defaults type and status on documents that omit them', async () => {
      mockGqeQuery.mockResolvedValue({
        documents: [{ id: 'nodes/bare', frontmatter: { title: 'Bare' }, body: '' }],
        sourceNodes: [],
        mode: 'graph',
        hopsUsed: 1,
        nodesTraversed: 1,
      });

      const { data } = await callJson('resolve', { selector: '#any' });

      expect(data.documents[0]).toMatchObject({ type: 'document', status: 'draft' });
    });
  });

  describe('search (read tool)', () => {
    it('builds a contextnest://search selector with spaces as +', async () => {
      mockGqeQuery.mockResolvedValue({
        documents: [
          { id: 'nodes/auth', frontmatter: { title: 'Auth', description: 'How auth works' }, body: 'b' },
        ],
        sourceNodes: [],
        mode: 'graph',
        hopsUsed: 2,
        nodesTraversed: 3,
      });

      const { data } = await callJson('search', { query: 'auth   flow' });

      expect(mockGqeQuery).toHaveBeenCalledWith('contextnest://search/auth+flow', {
        hops: 2,
        full: false,
      });
      expect(data.documents[0]).toMatchObject({ id: 'nodes/auth', description: 'How auth works' });
    });

    it('forwards hops and full to the query engine', async () => {
      mockGqeQuery.mockResolvedValue({
        documents: [],
        sourceNodes: [],
        mode: 'full',
        hopsUsed: 0,
        nodesTraversed: 0,
      });

      await callJson('search', { query: 'x', hops: 1, full: true });

      expect(mockGqeQuery).toHaveBeenCalledWith('contextnest://search/x', { hops: 1, full: true });
    });
  });

  describe('read_pack (read tool)', () => {
    it("resolves the pack's own query and returns its agent instructions", async () => {
      mockStorage.readPacks.mockResolvedValue([]);
      mockPackGet.mockReturnValue({
        id: 'onboarding.basics',
        label: 'Onboarding',
        description: 'Start here',
        query: '#onboarding',
        agent_instructions: 'Read these in order',
      });
      mockGqeQuery.mockResolvedValue({
        documents: [{ id: 'nodes/intro', frontmatter: { title: 'Intro' }, body: 'hello' }],
        sourceNodes: [],
        mode: 'graph',
        hopsUsed: 2,
        nodesTraversed: 1,
      });

      const { data } = await callJson('read_pack', { id: 'onboarding.basics' });

      expect(mockGqeQuery).toHaveBeenCalledWith('#onboarding', { hops: 2 });
      expect(data.pack).toMatchObject({ id: 'onboarding.basics', label: 'Onboarding' });
      expect(data.agent_instructions).toBe('Read these in order');
      expect(data.documents[0].body).toBe('hello');
    });

    it('falls back to a pack: selector when the pack declares no query', async () => {
      mockStorage.readPacks.mockResolvedValue([]);
      mockPackGet.mockReturnValue({ id: 'basics', label: 'Basics' });
      mockGqeQuery.mockResolvedValue({
        documents: [],
        sourceNodes: [],
        mode: 'graph',
        hopsUsed: 1,
        nodesTraversed: 0,
      });

      await callJson('read_pack', { id: 'basics', hops: 1 });

      expect(mockGqeQuery).toHaveBeenCalledWith('pack:basics', { hops: 1 });
    });

    it('reports an unknown pack without querying the graph', async () => {
      mockStorage.readPacks.mockResolvedValue([]);
      mockPackGet.mockReturnValue(undefined);

      const { raw } = await call('read_pack', { id: 'nope' });

      expect(raw).toBe('Pack "nope" not found');
      expect(mockGqeQuery).not.toHaveBeenCalled();
    });
  });

  describe('list_checkpoints (read tool)', () => {
    it('returns the most recent checkpoints, honouring limit', async () => {
      mockLoadCheckpointHistory.mockResolvedValue({
        checkpoints: [{ number: 1 }, { number: 2 }, { number: 3 }],
      });

      const { data } = await callJson('list_checkpoints', { limit: 2 });

      expect(data).toEqual([{ number: 2 }, { number: 3 }]);
    });

    it('defaults to the last 10', async () => {
      const checkpoints = Array.from({ length: 15 }, (_, i) => ({ number: i + 1 }));
      mockLoadCheckpointHistory.mockResolvedValue({ checkpoints });

      const { data } = await callJson('list_checkpoints', {});

      expect(data).toHaveLength(10);
      expect(data[0].number).toBe(6);
    });

    it('reports an empty chain in prose rather than an empty array', async () => {
      mockLoadCheckpointHistory.mockResolvedValue(null);

      const { raw } = await call('list_checkpoints', {});

      expect(raw).toBe('No checkpoints found.');
    });
  });

  describe('read_version (read tool)', () => {
    it('reconstructs the requested version and returns raw content', async () => {
      mockReconstructVersion.mockResolvedValue('---\ntitle: Old\n---\n\nv1 body\n');

      const { raw } = await call('read_version', { path: 'nodes/api-design.md', version: 1 });

      expect(mockReconstructVersion).toHaveBeenCalledWith('nodes/api-design', 1);
      expect(raw).toContain('v1 body');
    });
  });

  describe('update_document (write tool)', () => {
    const EXISTING = {
      id: 'nodes/existing',
      frontmatter: { title: 'Existing', type: 'document', status: 'draft', version: 1 },
      body: '\nold\n',
      filePath: '',
      rawContent: '',
    };

    async function armPublish(version = 2) {
      const { publishDocument } = await import('@promptowl/contextnest-engine');
      vi.mocked(publishDocument).mockResolvedValue({
        node: {
          id: 'nodes/existing',
          frontmatter: { title: 'Existing', type: 'document', status: 'published', version },
          body: '\nnew\n',
          filePath: '',
          rawContent: '',
        },
        checkpointNumber: 4,
        versionEntry: {
          chain_hash: 'hash-2',
          version,
          content_hash: 'c2',
          edited_by: 'testuser',
          keyframe: false,
          edited_at: '2024-01-01T00:00:00.000Z',
        },
      } as never);
      return publishDocument;
    }

    it('applies field updates, publishes, and commits', async () => {
      mockStorage.readDocument.mockResolvedValue({ ...EXISTING, frontmatter: { ...EXISTING.frontmatter } });
      const publishDocument = await armPublish();

      const { data } = await callJson('update_document', {
        path: 'nodes/existing.md',
        title: 'Renamed',
        status: 'published',
        tags: ['eng', '#ops'],
        body: 'new body',
      });

      expect(publishDocument).toHaveBeenCalledWith(
        mockStorage,
        'nodes/existing',
        expect.objectContaining({ editedBy: 'testuser' }),
      );
      expect(mockStorage.regenerateIndex).toHaveBeenCalledOnce();
      expect(mockSync.commitFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'nodes/existing.md', message: 'update nodes/existing' }),
      );
      expect(data.version).toBe(2);
      expect(data.checkpoint).toBe(4);
    });

    it('normalises tags to a # prefix and stamps updated_at before publishing', async () => {
      const doc = { ...EXISTING, frontmatter: { ...EXISTING.frontmatter } };
      mockStorage.readDocument.mockResolvedValue(doc);
      await armPublish();

      await callJson('update_document', { path: 'nodes/existing', tags: ['eng', '#ops'] });

      expect(doc.frontmatter).toMatchObject({ tags: ['#eng', '#ops'] });
      expect((doc.frontmatter as { updated_at?: string }).updated_at).toEqual(expect.any(String));
    });

    it('refuses to publish a document that fails validation', async () => {
      mockStorage.readDocument.mockResolvedValue({ ...EXISTING, frontmatter: { ...EXISTING.frontmatter } });
      const { validateDocument, publishDocument } = await import('@promptowl/contextnest-engine');
      // Once — the default (valid) stub must survive into the next test.
      vi.mocked(validateDocument).mockReturnValueOnce({
        valid: false,
        errors: [{ field: 'title', message: 'too long' }],
      } as never);

      const { data, isError } = await callJson('update_document', {
        path: 'nodes/existing',
        title: 'x'.repeat(500),
      });

      expect(isError).toBe(true);
      expect(data.error).toBe('Validation failed');
      expect(publishDocument).not.toHaveBeenCalled();
      expect(mockSync.commitFile).not.toHaveBeenCalled();
    });

    it('commits the post-publish bytes so the repo mirrors publication state', async () => {
      mockStorage.readDocument.mockResolvedValue({ ...EXISTING, frontmatter: { ...EXISTING.frontmatter } });
      const publishDocument = await armPublish(7);
      const { serializeDocument } = await import('@promptowl/contextnest-engine');
      vi.mocked(serializeDocument).mockReturnValue('SERIALIZED');

      await callJson('update_document', { path: 'nodes/existing', body: 'new body' });

      const published = (await vi.mocked(publishDocument).mock.results[0].value).node;
      // The node handed to serializeDocument for the commit must be the PUBLISHED
      // one (status: published, version 7) — not the pre-publish draft.
      expect(vi.mocked(serializeDocument)).toHaveBeenLastCalledWith(published);
      expect(published.frontmatter).toMatchObject({ status: 'published', version: 7 });
    });
  });

  describe('publish_document (write tool)', () => {
    it('publishes, regenerates the index, and commits the re-read bytes', async () => {
      const { publishDocument, serializeDocument } = await import('@promptowl/contextnest-engine');
      vi.mocked(publishDocument).mockResolvedValue({
        node: {
          id: 'nodes/doc',
          frontmatter: { title: 'Doc', status: 'published', version: 5 },
          body: '',
          filePath: '',
          rawContent: '',
        },
        checkpointNumber: 9,
        versionEntry: {
          chain_hash: 'h5',
          version: 5,
          content_hash: 'c5',
          edited_by: 'author@example.com',
          keyframe: false,
          edited_at: '2024-01-01T00:00:00.000Z',
        },
      } as never);
      mockStorage.readDocument.mockResolvedValue({
        id: 'nodes/doc',
        frontmatter: { title: 'Doc', status: 'published', version: 5 },
        body: '',
        rawContent: '',
      });
      vi.mocked(serializeDocument).mockReturnValue('PUBLISHED BYTES');

      const { data } = await callJson('publish_document', {
        path: 'nodes/doc.md',
        author: 'author@example.com',
        note: 'ship it',
      });

      expect(publishDocument).toHaveBeenCalledWith(mockStorage, 'nodes/doc', {
        editedBy: 'author@example.com',
        note: 'ship it',
      });
      expect(mockSync.commitFile).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'nodes/doc.md',
          message: 'publish nodes/doc v5',
          content: Buffer.from('PUBLISHED BYTES', 'utf-8'),
        }),
      );
      expect(data).toMatchObject({ version: 5, checkpoint: 9, chain_hash: 'h5' });
    });
  });

  describe('stage_drift_suggestion (write tool)', () => {
    const DRIFTED = {
      id: 'nodes/doc',
      frontmatter: { title: 'Doc', governance: 'strict', zone: 'private' },
      body: 'drifted',
      rawContent: 'RAW DRIFTED',
    };

    it('diffs live bytes against the last approved version and stages a suggestion', async () => {
      mockStorage.readDocument.mockResolvedValue(DRIFTED);
      mockStorage.readHistory.mockResolvedValue({ versions: [{ version: 1 }, { version: 2 }] });
      mockReconstructVersion.mockResolvedValue('RAW APPROVED');

      const { stageSuggestion } = await import('@promptowl/contextnest-engine');
      vi.mocked(stageSuggestion).mockResolvedValue({
        meta: {
          suggestion_id: 'sugg-1',
          document_id: 'nodes/doc',
          doc_tier: 'strict',
          source: 'out-of-band-edit',
          target_hash: 't',
          proposed_hash: 'p',
          detected_at: '2024-01-01T00:00:00.000Z',
        },
        patchPath: '_suggestions/sugg-1.patch',
        metaPath: '_suggestions/sugg-1.yaml',
      } as never);

      const { data } = await callJson('stage_drift_suggestion', { path: 'nodes/doc', note: 'hand edit' });

      // The comparison baseline is the LATEST recorded version, not v1.
      expect(mockReconstructVersion).toHaveBeenCalledWith('nodes/doc', 2);
      expect(stageSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'nodes/doc',
          approvedRawContent: 'RAW APPROVED',
          proposedRawContent: 'RAW DRIFTED',
          source: 'out-of-band-edit',
          actor: 'testuser',
          zone: 'private',
          docTier: 'strict',
          note: 'hand edit',
        }),
      );
      expect(data.suggestion_id).toBe('sugg-1');
    });

    it('defaults docTier to standard when the node declares no governance tier', async () => {
      mockStorage.readDocument.mockResolvedValue({ ...DRIFTED, frontmatter: { title: 'Doc' } });
      mockStorage.readHistory.mockResolvedValue({ versions: [{ version: 1 }] });
      mockReconstructVersion.mockResolvedValue('RAW APPROVED');
      const { stageSuggestion } = await import('@promptowl/contextnest-engine');
      vi.mocked(stageSuggestion).mockResolvedValue({
        meta: { suggestion_id: 's', document_id: 'nodes/doc' },
        patchPath: 'p',
        metaPath: 'm',
      } as never);

      await callJson('stage_drift_suggestion', { path: 'nodes/doc', actor: 'someone' });

      expect(stageSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ docTier: 'standard', zone: undefined, actor: 'someone' }),
      );
    });

    it('errors when there is no history to compare against', async () => {
      mockStorage.readDocument.mockResolvedValue(DRIFTED);
      mockStorage.readHistory.mockResolvedValue({ versions: [] });
      const { stageSuggestion } = await import('@promptowl/contextnest-engine');

      const { data, isError } = await callJson('stage_drift_suggestion', { path: 'nodes/doc' });

      expect(isError).toBe(true);
      expect(data.error).toMatch(/No version history/);
      expect(stageSuggestion).not.toHaveBeenCalled();
    });
  });

  describe('approve_suggestion (write tool)', () => {
    it('applies the patch, re-reads the document, and commits the new canonical bytes', async () => {
      mockStorage.readDocument.mockResolvedValue({
        id: 'nodes/doc',
        frontmatter: { title: 'Doc', zone: 'private' },
        body: '',
        rawContent: '',
      });
      const { approveSuggestion, serializeDocument } = await import('@promptowl/contextnest-engine');
      vi.mocked(approveSuggestion).mockResolvedValue({
        versionEntry: { version: 3, chain_hash: 'h3' },
        chainEvent: { event_type: 'suggestion_approved' },
        archivedAt: '_archive/approved/sugg-1',
      } as never);
      vi.mocked(serializeDocument).mockReturnValue('NEW CANONICAL');

      const { data } = await callJson('approve_suggestion', {
        path: 'nodes/doc',
        suggestion_id: 'sugg-1',
        comment: 'looks right',
      });

      expect(approveSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'nodes/doc',
          suggestionId: 'sugg-1',
          zone: 'private',
          actor: 'testuser',
          comment: 'looks right',
        }),
      );
      expect(mockStorage.regenerateIndex).toHaveBeenCalledOnce();
      expect(mockSync.commitFile).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'nodes/doc.md',
          message: 'approve suggestion sugg-1 on nodes/doc',
          content: Buffer.from('NEW CANONICAL', 'utf-8'),
        }),
      );
      expect(data).toMatchObject({ version: 3, chain_hash: 'h3', chain_event_type: 'suggestion_approved' });
    });

    it("defaults the zone to 'default' for an unzoned node", async () => {
      mockStorage.readDocument.mockResolvedValue({
        id: 'nodes/doc',
        frontmatter: { title: 'Doc' },
        body: '',
        rawContent: '',
      });
      const { approveSuggestion } = await import('@promptowl/contextnest-engine');
      vi.mocked(approveSuggestion).mockResolvedValue({
        versionEntry: { version: 2, chain_hash: 'h2' },
        chainEvent: { event_type: 'suggestion_approved' },
        archivedAt: 'a',
      } as never);

      await callJson('approve_suggestion', { path: 'nodes/doc', suggestion_id: 's' });

      expect(approveSuggestion).toHaveBeenCalledWith(expect.objectContaining({ zone: 'default' }));
    });
  });

  describe('reject_suggestion (write tool)', () => {
    it('archives the patch and leaves the canonical document untouched', async () => {
      mockStorage.readDocument.mockResolvedValue({
        id: 'nodes/doc',
        frontmatter: { title: 'Doc', zone: 'private' },
        body: '',
        rawContent: '',
      });
      const { rejectSuggestion } = await import('@promptowl/contextnest-engine');
      vi.mocked(rejectSuggestion).mockResolvedValue({
        chainEvent: { event_type: 'suggestion_rejected' },
        archivedAt: '_archive/rejected/sugg-1',
      } as never);

      const { data } = await callJson('reject_suggestion', {
        path: 'nodes/doc',
        suggestion_id: 'sugg-1',
        reason: 'wrong approach',
      });

      expect(rejectSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ suggestionId: 'sugg-1', reason: 'wrong approach', zone: 'private' }),
      );
      // Rejection must not write the document or touch git.
      expect(mockStorage.writeDocument).not.toHaveBeenCalled();
      expect(mockSync.commitFile).not.toHaveBeenCalled();
      expect(data).toMatchObject({
        chain_event_type: 'suggestion_rejected',
        rejection_reason: 'wrong approach',
      });
    });
  });

  describe('input schemas reject unknown properties', () => {
    /** The registered zod schema for a tool, as the SDK would parse arguments with. */
    async function schemaFor(name: string) {
      const tools = await loadTools();
      return tools.get(name)!.schema as {
        safeParse(v: unknown): { success: boolean };
      };
    }

    it('rejects a misnamed argument instead of silently dropping it', async () => {
      // The whole point: `update_document({ path, contents })` used to validate
      // clean, publish a new version and leave the body untouched.
      const schema = await schemaFor('update_document');
      expect(schema.safeParse({ path: 'nodes/a', contents: 'hi' }).success).toBe(false);
    });

    it.each(['create_document', 'update_document', 'list_documents', 'search'])(
      '%s rejects unknown keys',
      async (name) => {
        const schema = await schemaFor(name);
        expect(schema.safeParse({ path: 'nodes/a', query: 'q', title: 'T', nope: 1 }).success).toBe(
          false,
        );
      },
    );

    it('accepts `content` as an alias for `body` on both write tools', async () => {
      expect(
        (await schemaFor('update_document')).safeParse({ path: 'nodes/a', content: 'hi' }).success,
      ).toBe(true);
      expect(
        (await schemaFor('create_document')).safeParse({
          path: 'nodes/a',
          title: 'A',
          content: 'hi',
        }).success,
      ).toBe(true);
    });
  });

  describe('update_document body aliasing and no-op detection', () => {
    const EXISTING = {
      id: 'nodes/existing',
      frontmatter: { title: 'Existing', type: 'document', status: 'draft', version: 3, tags: ['#eng'] },
      body: '\nold\n',
      filePath: '',
      rawContent: '',
    };

    function armDoc() {
      const doc = { ...EXISTING, frontmatter: { ...EXISTING.frontmatter } };
      mockStorage.readDocument.mockResolvedValue(doc);
      return doc;
    }

    async function armPublish() {
      const { publishDocument } = await import('@promptowl/contextnest-engine');
      vi.mocked(publishDocument).mockResolvedValue({
        node: { ...EXISTING, frontmatter: { ...EXISTING.frontmatter, version: 4 } },
        checkpointNumber: 9,
        versionEntry: {
          chain_hash: 'hash-4',
          version: 4,
          content_hash: 'c4',
          edited_by: 'testuser',
          keyframe: false,
          edited_at: '2024-01-01T00:00:00.000Z',
        },
      } as never);
      return publishDocument;
    }

    it('writes the body when it arrives as `content`', async () => {
      const doc = armDoc();
      await armPublish();

      const { data } = await callJson('update_document', {
        path: 'nodes/existing',
        content: 'brand new body',
      });

      expect(doc.body).toBe('\nbrand new body\n');
      expect(data.changed).toBe(true);
      expect(mockStorage.writeDocument).toHaveBeenCalled();
    });

    it('refuses `body` and `content` that disagree rather than picking one', async () => {
      armDoc();
      const { data, isError } = await callJson('update_document', {
        path: 'nodes/existing',
        body: 'one',
        content: 'two',
      });

      expect(isError).toBe(true);
      expect(data.error).toMatch(/aliases for the same field/);
      expect(mockStorage.writeDocument).not.toHaveBeenCalled();
    });

    it('errors when no updatable field is supplied', async () => {
      const { publishDocument } = await import('@promptowl/contextnest-engine');
      const { data, isError } = await callJson('update_document', { path: 'nodes/existing' });

      expect(isError).toBe(true);
      expect(data.error).toMatch(/Nothing to update/);
      expect(mockStorage.readDocument).not.toHaveBeenCalled();
      expect(vi.mocked(publishDocument)).not.toHaveBeenCalled();
    });

    it('does not mint a version when the supplied values match what is stored', async () => {
      armDoc();
      const { publishDocument } = await import('@promptowl/contextnest-engine');

      const { data } = await callJson('update_document', {
        path: 'nodes/existing',
        title: 'Existing',
        body: 'old',
        tags: ['eng'],
      });

      expect(data.changed).toBe(false);
      expect(data.version).toBe(3);
      expect(data.message).toMatch(/No changes/);
      expect(vi.mocked(publishDocument)).not.toHaveBeenCalled();
      expect(mockStorage.writeDocument).not.toHaveBeenCalled();
      expect(mockSync.commitFile).not.toHaveBeenCalled();
    });

    it('sets description, and clears it when given an empty string', async () => {
      const doc = armDoc();
      await armPublish();

      await callJson('update_document', { path: 'nodes/existing', description: 'What this is' });
      expect(doc.frontmatter).toMatchObject({ description: 'What this is' });

      await callJson('update_document', { path: 'nodes/existing', description: '' });
      expect(doc.frontmatter).not.toHaveProperty('description');
    });
  });

  describe('create_document description and body alias', () => {
    async function armCreate() {
      mockStorage.readDocument.mockRejectedValueOnce(new Error('not found'));
      mockStorage.writeDocument.mockResolvedValue(undefined);
      const { publishDocument } = await import('@promptowl/contextnest-engine');
      vi.mocked(publishDocument).mockResolvedValue({
        node: {
          id: 'nodes/new-doc',
          frontmatter: { title: 'New Doc', status: 'published', version: 1 },
          body: '',
          filePath: '',
          rawContent: '',
        },
        checkpointNumber: 1,
        versionEntry: {
          chain_hash: 'h1',
          version: 1,
          content_hash: 'c1',
          edited_by: 'testuser',
          keyframe: true,
          edited_at: '2024-01-01T00:00:00.000Z',
        },
      } as never);
    }

    it('carries description into the frontmatter and accepts `content` for the body', async () => {
      await armCreate();
      const { serializeDocument } = await import('@promptowl/contextnest-engine');

      await callJson('create_document', {
        path: 'nodes/new-doc',
        title: 'New Doc',
        description: 'A summary',
        content: 'Body via alias',
      });

      const node = vi.mocked(serializeDocument).mock.calls[0][0] as {
        frontmatter: { description?: string };
        body: string;
      };
      expect(node.frontmatter.description).toBe('A summary');
      expect(node.body).toBe('\nBody via alias\n');
    });
  });

  describe('list_documents path filter', () => {
    it('keeps the folder and its descendants, on segment boundaries', async () => {
      mockStorage.discoverDocuments.mockResolvedValue([
        { id: 'nodes/history', frontmatter: { title: 'H', status: 'draft' }, body: '' },
        { id: 'nodes/history/2024', frontmatter: { title: 'H24', status: 'draft' }, body: '' },
        { id: 'nodes/history-of-art', frontmatter: { title: 'Art', status: 'draft' }, body: '' },
        { id: 'nodes/other', frontmatter: { title: 'O', status: 'draft' }, body: '' },
      ]);

      const { data } = await callJson('list_documents', { path: 'nodes/history' });

      expect(data.map((d: { id: string }) => d.id)).toEqual(['nodes/history', 'nodes/history/2024']);
    });
  });

  describe('search falls back to body-level matching', () => {
    it('retries in full mode when the metadata index finds nothing', async () => {
      mockGqeQuery
        .mockResolvedValueOnce({ documents: [], sourceNodes: [], mode: 'graph', hopsUsed: 0, nodesTraversed: 0 })
        .mockResolvedValueOnce({
          documents: [{ id: 'nodes/auth', frontmatter: { title: 'Auth' }, body: 'term lives here' }],
          sourceNodes: [],
          mode: 'full',
          hopsUsed: 1,
          nodesTraversed: 1,
        });

      const { data } = await callJson('search', { query: 'term' });

      expect(mockGqeQuery).toHaveBeenNthCalledWith(1, 'contextnest://search/term', { hops: 2, full: false });
      expect(mockGqeQuery).toHaveBeenNthCalledWith(2, 'contextnest://search/term', { hops: 2, full: true });
      expect(data.documents[0].id).toBe('nodes/auth');
      expect(data.traversal.mode).toBe('full');
    });

    it('does not retry when the index already matched', async () => {
      mockGqeQuery.mockResolvedValue({
        documents: [{ id: 'nodes/a', frontmatter: { title: 'A' }, body: '' }],
        sourceNodes: [],
        mode: 'graph',
        hopsUsed: 1,
        nodesTraversed: 1,
      });

      await callJson('search', { query: 'term' });

      expect(mockGqeQuery).toHaveBeenCalledOnce();
    });
  });

  describe('tool registration count', () => {
    it('registers all 21 tools', async () => {
      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      expect(tools.size).toBe(21);
    });

    it('registers the expected tool names', async () => {
      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const expected = [
        'vault_info',
        'resolve',
        'read_document',
        'list_documents',
        'get_skill',
        'get_skill_install_manifest',
        'document_format',
        'read_index',
        'read_pack',
        'search',
        'verify_integrity',
        'list_checkpoints',
        'read_version',
        'create_document',
        'update_document',
        'delete_document',
        'publish_document',
        'stage_drift_suggestion',
        'list_suggestions',
        'approve_suggestion',
        'reject_suggestion',
      ];
      for (const name of expected) {
        expect(tools.has(name), `Expected tool "${name}" to be registered`).toBe(true);
      }
    });
  });
});
