import { describe, it, expect } from 'vitest';
import {
  assertSkillNode,
  buildInstallManifest,
  renderSkill,
  skillNameFromPath,
  substitutePlaceholders,
  NotASkillNodeError,
  type SkillSource,
} from './skills';

function skillDoc(overrides: Partial<SkillSource> = {}): SkillSource {
  return {
    id: 'nodes/execution/skills/context-layer-maintenance',
    frontmatter: {
      title: 'Context Layer Maintenance',
      type: 'skill',
      status: 'published',
      version: 2,
      skill: {
        trigger: 'Use when a decision, gotcha, or process worth keeping surfaces mid-session',
        inputs: [{ name: 'topic', type: 'string', required: true, description: 'What to capture' }],
        tools_required: ['create_document', 'mcp__other__thing'],
        output_format: 'markdown',
        guard_rails: ['Never store source code'],
      },
    },
    body: '\n## Steps\n\n1. Search first with {{server_alias}}.\n',
    ...overrides,
  };
}

const BASE = { serverAlias: 'ctx', vaultId: 'bigearnie', vaultName: 'BigEarnie Context' };

describe('skillNameFromPath', () => {
  it.each([
    ['nodes/execution/skills/context-layer-maintenance', 'context-layer-maintenance'],
    ['nodes/skills/Vault Bootstrap.md', 'vault-bootstrap'],
    ['nodes/skills/Weird__Name!!', 'weird-name'],
    ['', 'skill'],
  ])('slugifies %s → %s', (input, expected) => {
    expect(skillNameFromPath(input)).toBe(expected);
  });
});

describe('substitutePlaceholders', () => {
  it('resolves the vault placeholders', () => {
    const out = substitutePlaceholders(
      'Call {{server_alias}} on {{node_path}} in {{ vault_id }}',
      { serverAlias: 'ctx', vaultId: 'bigearnie', nodePath: 'nodes/a' },
    );
    expect(out).toBe('Call ctx on nodes/a in bigearnie');
  });

  it('leaves existing mcp__ prefixes alone — they may name a different server', () => {
    const out = substitutePlaceholders('use mcp__github__create_pr', {
      serverAlias: 'ctx',
      vaultId: 'v',
      nodePath: 'p',
    });
    expect(out).toBe('use mcp__github__create_pr');
  });
});

describe('assertSkillNode', () => {
  it('returns the skill block for a valid skill node', () => {
    expect(assertSkillNode(skillDoc()).trigger).toContain('Use when a decision');
  });

  it('rejects a non-skill node with an actionable message', () => {
    const doc = skillDoc({ frontmatter: { title: 'API Design', type: 'document' } });
    expect(() => assertSkillNode(doc)).toThrow(NotASkillNodeError);
    expect(() => assertSkillNode(doc)).toThrow(/type "document", not "skill"/);
  });

  it('treats an untyped node as a document', () => {
    const doc = skillDoc({ frontmatter: { title: 'Notes' } });
    expect(() => assertSkillNode(doc)).toThrow(/type "document"/);
  });

  it('refuses to default a missing trigger', () => {
    const doc = skillDoc({
      frontmatter: { title: 'Half Skill', type: 'skill', skill: { trigger: '  ' } },
    });
    expect(() => assertSkillNode(doc)).toThrow(/no skill\.trigger/);
  });
});

describe('renderSkill', () => {
  it('derives the claude-code description from skill.trigger', () => {
    const r = renderSkill(skillDoc(), { harness: 'claude-code', ...BASE });
    expect(r.name).toBe('context-layer-maintenance');
    expect(r.description).toBe(skillDoc().frontmatter.skill!.trigger);
    expect(r.content.startsWith('---\nname: context-layer-maintenance\n')).toBe(true);
    expect(r.content).toContain(`description: "${r.description}"`);
  });

  it('quotes the description so a trigger containing ":" stays valid YAML', () => {
    const doc = skillDoc();
    doc.frontmatter.skill!.trigger = 'Use when: a #tag is needed';
    const r = renderSkill(doc, { harness: 'claude-code', ...BASE });
    expect(r.content).toContain('description: "Use when: a #tag is needed"');
  });

  it('qualifies bare tool names with the caller alias and leaves qualified ones alone', () => {
    const r = renderSkill(skillDoc(), { harness: 'claude-code', ...BASE });
    expect(r.content).toContain('- mcp__ctx__create_document');
    expect(r.content).toContain('- mcp__other__thing');
  });

  it('emits no hardcoded mcp__skynest__ prefix', () => {
    const r = renderSkill(skillDoc(), { harness: 'claude-code', ...BASE });
    expect(r.content).not.toContain('mcp__skynest__');
  });

  it('includes the node body and resolves its placeholders', () => {
    const r = renderSkill(skillDoc(), { harness: 'claude-code', ...BASE });
    expect(r.content).toContain('1. Search first with ctx.');
  });

  it('formats cursor rules with alwaysApply frontmatter', () => {
    const r = renderSkill(skillDoc(), { harness: 'cursor', ...BASE, scope: 'project' });
    expect(r.content).toContain('alwaysApply: false');
    expect(r.content).not.toContain('name: context-layer-maintenance\n');
    expect(r.relativePath).toBe('.cursor/rules/context-layer-maintenance.mdc');
  });

  it('emits the body unwrapped for the raw harness', () => {
    const r = renderSkill(skillDoc(), { harness: 'raw', ...BASE });
    expect(r.content.startsWith('---')).toBe(false);
    expect(r.content).toContain('# Context Layer Maintenance');
  });
});

describe('buildInstallManifest', () => {
  const opts = { harness: 'claude-code' as const, ...BASE };

  it('produces a loader that fetches rather than carrying the procedure', () => {
    const m = buildInstallManifest(skillDoc(), { ...opts, scope: 'user', mode: 'loader' });
    const content = m.files[0].content;

    expect(m.skill.mode).toBe('loader');
    expect(content).toContain('mcp__ctx__get_skill({ path: "nodes/execution/skills/context-layer-maintenance"');
    expect(content).toContain('## If the vault is unreachable');
    // The steps stay in the vault.
    expect(content).not.toContain('Search first with ctx');
  });

  it('carries the trigger locally — matching happens before any fetch can', () => {
    const m = buildInstallManifest(skillDoc(), { ...opts, scope: 'user', mode: 'loader' });
    expect(m.files[0].content).toContain(`description: "${skillDoc().frontmatter.skill!.trigger}"`);
  });

  it('inlines the body in full mode and warns that it will drift', () => {
    const m = buildInstallManifest(skillDoc(), { ...opts, scope: 'user', mode: 'full' });
    const content = m.files[0].content;

    expect(content).toContain('Search first with ctx');
    expect(content).toContain('Offline snapshot');
    expect(content).toContain('at version 2');
    expect(m.notes).toMatch(/WILL drift/);
  });

  it('targets the project tree for scope: project and the home tree for scope: user', () => {
    const project = buildInstallManifest(skillDoc(), { ...opts, scope: 'project', mode: 'loader' });
    const user = buildInstallManifest(skillDoc(), { ...opts, scope: 'user', mode: 'loader' });

    expect(project.files[0]).toMatchObject({
      relative_path: '.claude/skills/context-layer-maintenance/SKILL.md',
      base: 'project_root',
    });
    expect(user.files[0]).toMatchObject({
      relative_path: '~/.claude/skills/context-layer-maintenance/SKILL.md',
      base: 'home',
    });
  });

  it('states that the agent, not the server, does the writing', () => {
    const m = buildInstallManifest(skillDoc(), { ...opts, scope: 'user', mode: 'loader' });
    expect(m.notes).toMatch(/cannot touch your filesystem/);
  });

  it('rejects a non-skill node', () => {
    const doc = skillDoc({ frontmatter: { title: 'Doc', type: 'document' } });
    expect(() => buildInstallManifest(doc, { ...opts, scope: 'user', mode: 'loader' })).toThrow(
      NotASkillNodeError,
    );
  });
});
