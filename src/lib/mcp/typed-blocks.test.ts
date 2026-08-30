/**
 * Unit tests for typed-block reconciliation.
 *
 * These cover the spec rules directly (§13 rules 9/17, §1.10 rules 18/19)
 * without going through the MCP layer, so a failure points at the rule rather
 * than at the tool wiring.
 */

import { describe, it, expect } from 'vitest';
import type { Frontmatter } from '@promptowl/contextnest-engine';

import { applyTypedBlocks } from './typed-blocks';

function fm(extra: Partial<Frontmatter> = {}): Frontmatter {
  return { title: 'Test', type: 'document', status: 'draft', version: 1, ...extra } as Frontmatter;
}

const SOURCE = { transport: 'mcp' as const, server: 'harvest', tools: ['list_projects'] };

describe('applyTypedBlocks', () => {
  describe('rule 9 — source block required on type: source', () => {
    it('rejects a source node with no block, on create or update alike', () => {
      const result = applyTypedBlocks(fm(), { type: 'source' });
      expect(result).toMatchObject({ ok: false });
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toMatch(/rule 9/);
      expect(result.error).toMatch(/transport/);
    });

    it('accepts a supplied block', () => {
      const frontmatter = fm();
      expect(applyTypedBlocks(frontmatter, { type: 'source', source: SOURCE })).toEqual({ ok: true });
      expect(frontmatter.source).toEqual(SOURCE);
    });

    it('keeps an existing block when the caller supplies none', () => {
      const frontmatter = fm({ type: 'source', source: SOURCE });
      expect(applyTypedBlocks(frontmatter, { type: 'source' })).toEqual({ ok: true });
      expect(frontmatter.source).toEqual(SOURCE);
    });

    it('replaces an existing block wholesale', () => {
      const frontmatter = fm({ type: 'source', source: SOURCE });
      const next = { transport: 'rest' as const, server: 'bigearnie', tools: ['get_estimate'], cache_ttl: 300 };
      expect(applyTypedBlocks(frontmatter, { type: 'source', source: next })).toEqual({ ok: true });
      expect(frontmatter.source).toEqual(next);
    });
  });

  describe('rule 17 — source block forbidden elsewhere', () => {
    it('rejects a source block aimed at a non-source type', () => {
      const result = applyTypedBlocks(fm(), { type: 'document', source: SOURCE });
      expect(result).toMatchObject({ ok: false });
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toMatch(/rule 17/);
    });

    it('drops the block when re-typing away from source', () => {
      const frontmatter = fm({ type: 'source', source: SOURCE });
      expect(applyTypedBlocks(frontmatter, { type: 'document' })).toEqual({ ok: true });
      expect(frontmatter.source).toBeUndefined();
    });
  });

  describe('rules 18/19 — skill block', () => {
    it('requires a trigger for a skill node that has none', () => {
      const result = applyTypedBlocks(fm(), { type: 'skill' });
      expect(result).toMatchObject({ ok: false });
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toMatch(/rule 18/);
    });

    it('accepts a create-time default trigger', () => {
      const frontmatter = fm();
      expect(
        applyTypedBlocks(frontmatter, { type: 'skill', defaultTrigger: 'when asked to test' }),
      ).toEqual({ ok: true });
      expect(frontmatter.skill).toMatchObject({
        trigger: 'when asked to test',
        tools_required: [],
        output_format: 'markdown',
      });
    });

    it('preserves fields the caller did not touch', () => {
      const frontmatter = fm({
        type: 'skill',
        skill: {
          trigger: 'old',
          inputs: [{ name: 'x', type: 'string' }],
          tools_required: ['a'],
          output_format: 'json',
          guard_rails: ['never delete'],
        },
      } as Partial<Frontmatter>);

      expect(applyTypedBlocks(frontmatter, { type: 'skill', trigger: 'new' })).toEqual({ ok: true });
      expect(frontmatter.skill).toEqual({
        trigger: 'new',
        inputs: [{ name: 'x', type: 'string' }],
        tools_required: ['a'],
        output_format: 'json',
        guard_rails: ['never delete'],
      });
    });

    it('rejects skill parameters aimed at a non-skill type', () => {
      const result = applyTypedBlocks(fm(), { type: 'document', trigger: 'whenever' });
      expect(result).toMatchObject({ ok: false });
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toMatch(/rule 19/);
    });

    it('drops the block when re-typing away from skill', () => {
      const frontmatter = fm({
        type: 'skill',
        skill: { trigger: 't', inputs: [], tools_required: [], output_format: 'markdown', guard_rails: [] },
      } as Partial<Frontmatter>);
      expect(applyTypedBlocks(frontmatter, { type: 'reference' })).toEqual({ ok: true });
      expect(frontmatter.skill).toBeUndefined();
    });
  });

  it('swaps blocks when re-typing straight from skill to source', () => {
    const frontmatter = fm({
      type: 'skill',
      skill: { trigger: 't', inputs: [], tools_required: [], output_format: 'markdown', guard_rails: [] },
    } as Partial<Frontmatter>);

    expect(applyTypedBlocks(frontmatter, { type: 'source', source: SOURCE })).toEqual({ ok: true });
    expect(frontmatter.skill).toBeUndefined();
    expect(frontmatter.source).toEqual(SOURCE);
  });
});
