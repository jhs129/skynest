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

vi.mock('@promptowl/contextnest-engine', () => {
  return {
    GraphQueryEngine: vi.fn().mockImplementation(() => ({ query: mockGqeQuery })),
    PackLoader: vi.fn().mockImplementation(() => ({ get: vi.fn() })),
    CheckpointManager: vi.fn().mockImplementation(() => ({
      loadCheckpointHistory: vi.fn(),
    })),
    VersionManager: vi.fn().mockImplementation(() => ({
      reconstructVersion: vi.fn(),
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
    tool: vi.fn((name: string, description: string, schema: unknown, handler: ToolHandler) => {
      tools.set(name, { description, schema, handler });
    }),
  };
  return { server, tools };
}

function makeCtx(userToken = 'ghp_test', userLogin = 'testuser') {
  return { authInfo: { extra: { userToken, userLogin } } };
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: commitFile / deleteFile are fire-and-forget, so resolve silently
  mockSync.commitFile.mockResolvedValue(undefined);
  mockSync.deleteFile.mockResolvedValue(undefined);
  mockStorage.regenerateIndex.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerTools', () => {
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

  describe('tool registration count', () => {
    it('registers all 19 tools', async () => {
      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      expect(tools.size).toBe(19);
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
