import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockReadDocument = vi.fn();
const mockReadConfig = vi.fn();
const mockProviderRead = vi.fn();

vi.mock('./index', () => ({
  createEngine: vi.fn(() => ({
    storage: {
      readDocument: mockReadDocument,
      readConfig: mockReadConfig,
      provider: { read: mockProviderRead },
    },
  })),
}));

const SKILL_DOC = {
  id: 'nodes/skills/vault-bootstrap',
  frontmatter: {
    title: 'Vault Bootstrap',
    type: 'skill',
    status: 'published',
    version: 1,
    skill: {
      trigger: 'Use when first connecting to this vault',
      tools_required: ['vault_info'],
      output_format: 'markdown',
    },
  },
  body: '\n1. Call {{server_alias}} vault_info.\n',
};

const CONFIG_YAML = 'skills:\n  bootstrap: nodes/skills/vault-bootstrap\n';

describe('resolveBootstrapSkill', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderRead.mockResolvedValue(Buffer.from(CONFIG_YAML, 'utf-8'));
    mockReadDocument.mockResolvedValue(SKILL_DOC);
    mockReadConfig.mockResolvedValue({ name: 'Test Vault' });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  async function resolve(alias = 'ctx') {
    const { resolveBootstrapSkill } = await import('./bootstrap-skill');
    return resolveBootstrapSkill(alias);
  }

  it('builds a claude-code loader manifest from the designated node', async () => {
    const skill = await resolve();

    expect(mockReadDocument).toHaveBeenCalledWith('nodes/skills/vault-bootstrap');
    expect(skill).toMatchObject({
      path: 'nodes/skills/vault-bootstrap',
      title: 'Vault Bootstrap',
      vaultName: 'Test Vault',
    });
    const file = skill!.manifest.files[0];
    expect(file.relative_path).toBe('~/.claude/skills/vault-bootstrap/SKILL.md');
    expect(file.content).toContain('description: "Use when first connecting to this vault"');
    // Loader mode: the trigger travels, the procedure stays in the vault.
    expect(file.content).not.toContain('Call ctx vault_info');
  });

  it('threads the caller alias through instead of a hardcoded prefix', async () => {
    const skill = await resolve('my-vault');
    expect(skill!.manifest.files[0].content).toContain('mcp__my-vault__get_skill');
    expect(skill!.manifest.files[0].content).not.toContain('mcp__skynest__');
  });

  it('returns null quietly when the vault designates no bootstrap skill', async () => {
    mockProviderRead.mockResolvedValue(Buffer.from('name: Test Vault\n', 'utf-8'));

    expect(await resolve()).toBeNull();
    expect(mockReadDocument).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('degrades to null but logs when the designated node is missing', async () => {
    mockReadDocument.mockRejectedValue(new Error('not found'));

    expect(await resolve()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('degrades to null when the designated node is not a skill', async () => {
    mockReadDocument.mockResolvedValue({
      ...SKILL_DOC,
      frontmatter: { title: 'Not A Skill', type: 'document' },
    });

    expect(await resolve()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});
