import { describe, it, expect, vi } from 'vitest';
import { readSkillsConfig } from './skills-config';
import type { NestStorage } from '@promptowl/contextnest-engine';

function storageReturning(raw: string | null | Error): NestStorage {
  const read = vi.fn(async () => {
    if (raw instanceof Error) throw raw;
    return raw === null ? null : Buffer.from(raw, 'utf-8');
  });
  return { provider: { read } } as unknown as NestStorage;
}

describe('readSkillsConfig', () => {
  it('reads the designated bootstrap node path', async () => {
    const cfg = await readSkillsConfig(
      storageReturning('name: Test Vault\nskills:\n  bootstrap: nodes/skills/vault-bootstrap\n'),
    );
    expect(cfg).toEqual({ bootstrap: 'nodes/skills/vault-bootstrap' });
  });

  it('strips a .md extension so the path matches a node id', async () => {
    const cfg = await readSkillsConfig(
      storageReturning('skills:\n  bootstrap: "  nodes/skills/boot.md  "\n'),
    );
    expect(cfg).toEqual({ bootstrap: 'nodes/skills/boot' });
  });

  it.each([
    ['no config file', null],
    ['no skills block', 'name: Test Vault\n'],
    ['a skills block with no bootstrap', 'skills:\n  other: x\n'],
    ['a blank bootstrap', 'skills:\n  bootstrap: "   "\n'],
    ['a non-string bootstrap', 'skills:\n  bootstrap:\n    - a\n'],
    ['a scalar document', 'just a string\n'],
    ['malformed YAML', 'skills:\n  bootstrap: [unclosed\n'],
  ])('returns null for %s', async (_label, raw) => {
    expect(await readSkillsConfig(storageReturning(raw))).toBeNull();
  });

  it('returns null rather than throwing when storage is unreachable', async () => {
    expect(await readSkillsConfig(storageReturning(new Error('ENOENT')))).toBeNull();
  });
});
