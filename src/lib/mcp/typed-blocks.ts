/**
 * Reconciling a node's `type` with its typed frontmatter blocks.
 *
 * Two node types carry a required companion block, and the spec constrains them
 * from both sides:
 *
 *   - `type: source` MUST have a `source:` block (§13 rule 9) and no other type
 *     may have one (rule 17).
 *   - `type: skill` MUST have a `skill:` block (§1.10 rule 18) and no other type
 *     may have one (rule 19).
 *
 * Enforced only on the way out (at validation), those rules produce write-once
 * nodes: a `type: source` node created without a block fails every subsequent
 * update, and there is no way to supply the missing field. So the pairing is
 * settled HERE, before anything is written, for both create and update — and a
 * re-type carries its blocks with it rather than leaving the node in a state
 * the validator will reject.
 */

import { z } from 'zod';
import { TRANSPORTS } from '@promptowl/contextnest-engine';
import type { Frontmatter } from '@promptowl/contextnest-engine';

/**
 * The `source` block as callers supply it.
 *
 * Deliberately restated rather than inferred from the engine's internal
 * `sourceMetaSchema`: this is a published tool contract, and an agent that
 * cannot see the field names cannot construct the block at all — which is the
 * defect this module exists to fix. The engine's frontmatter validation remains
 * the authority; this shape only has to agree with it.
 */
export const sourceBlockSchema = z.object({
  transport: z
    .enum(TRANSPORTS)
    .describe('How the source is reached: mcp, rest, cli or function'),
  server: z
    .string()
    .optional()
    .describe('Name of the MCP server or endpoint this source lives on'),
  tools: z
    .array(z.string())
    .min(1)
    .describe('Tool names an agent calls to fetch this source. At least one.'),
  depends_on: z
    .array(z.string())
    .optional()
    .describe('contextnest:// URIs of sources that must be fetched first'),
  cache_ttl: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Seconds a fetched result stays usable'),
});

export type SourceBlockInput = z.infer<typeof sourceBlockSchema>;

/** Node types the vault accepts, in the order the spec lists them. */
export const NODE_TYPES = [
  'document',
  'snippet',
  'glossary',
  'persona',
  'prompt',
  'source',
  'tool',
  'reference',
  'skill',
] as const;

export const SKILL_OUTPUT_FORMATS = ['markdown', 'json', 'text', 'code'] as const;

export interface TypedBlockArgs {
  /** The type the node will have AFTER this write. */
  type: NonNullable<Frontmatter['type']>;
  source?: SourceBlockInput;
  trigger?: string;
  tools_required?: string[];
  output_format?: (typeof SKILL_OUTPUT_FORMATS)[number];
  /**
   * Trigger to fall back on when a skill node is being created and the caller
   * named none. Create has always defaulted this from the title; update does
   * not, because a guessed trigger on an existing node is a silent behaviour
   * change rather than a starting point.
   */
  defaultTrigger?: string;
}

export type TypedBlockResult = { ok: true } | { ok: false; error: string };

/**
 * Settle `frontmatter.source` and `frontmatter.skill` against `args.type`,
 * mutating `frontmatter` in place.
 *
 * A block belonging to the type being left is DROPPED rather than refused: the
 * caller asked for the new type, the old block is illegal under it (rules 17 and
 * 19), and there is no third option. A block belonging to the type being entered
 * must be supplied, because nothing else can invent it.
 */
export function applyTypedBlocks(
  frontmatter: Frontmatter,
  args: TypedBlockArgs,
): TypedBlockResult {
  const { type } = args;

  if (args.source !== undefined && type !== 'source') {
    return {
      ok: false,
      error:
        `A source block is only valid on type: source (§13 rule 17), and this node is type: "${type}". ` +
        `Pass type: "source" in the same call to convert it, or drop the source parameter.`,
    };
  }

  const skillArgsGiven =
    args.trigger !== undefined ||
    args.tools_required !== undefined ||
    args.output_format !== undefined;
  if (skillArgsGiven && type !== 'skill') {
    return {
      ok: false,
      error:
        `trigger / tools_required / output_format describe a skill block, which is only valid on ` +
        `type: skill (§1.10 rule 19), and this node is type: "${type}". ` +
        `Pass type: "skill" in the same call to convert it, or drop those parameters.`,
    };
  }

  if (type === 'source') {
    const block = args.source ?? frontmatter.source;
    if (!block) {
      return {
        ok: false,
        error:
          'A source block is required when type is "source" (§13 rule 9), and this node has none. ' +
          'Pass source: { transport, server?, tools: [...], depends_on?, cache_ttl? } — ' +
          'e.g. source: { transport: "mcp", server: "harvest", tools: ["list_projects"] }.',
      };
    }
    frontmatter.source = block;
    delete frontmatter.skill;
    return { ok: true };
  }

  if (type === 'skill') {
    const existing = frontmatter.skill;
    const trigger = args.trigger ?? existing?.trigger ?? args.defaultTrigger;
    if (!trigger) {
      return {
        ok: false,
        error:
          'A skill block is required when type is "skill" (§1.10 rule 18), and this node has none. ' +
          'Pass trigger: "<when this skill should fire>" — it is what a harness matches on, ' +
          'so it cannot be defaulted for an existing node.',
      };
    }
    frontmatter.skill = {
      trigger,
      inputs: existing?.inputs ?? [],
      tools_required: args.tools_required ?? existing?.tools_required ?? [],
      output_format: args.output_format ?? existing?.output_format ?? 'markdown',
      guard_rails: existing?.guard_rails ?? [],
    };
    delete frontmatter.source;
    return { ok: true };
  }

  // Every other type carries neither block. Dropping is what makes a re-type
  // away from source/skill possible at all — rules 17 and 19 would otherwise
  // reject the node for a block the caller never asked to keep.
  delete frontmatter.source;
  delete frontmatter.skill;
  return { ok: true };
}
