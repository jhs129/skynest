/**
 * Server-side resolution of the vault's designated entry-point skill, for the
 * docs page.
 *
 * The docs page used to ship a hardcoded skill template — identical for every
 * instance regardless of what that vault actually contains, and drifting from the
 * vault by construction. This resolves the real one instead.
 */

import { createEngine } from './index';
import { readSkillsConfig } from './skills-config';
import { buildInstallManifest } from '@/lib/mcp/skills';
import type { InstallManifest } from '@/lib/mcp/skills';

export interface ResolvedBootstrapSkill {
  /** Node path of the designated skill. */
  path: string;
  title: string;
  /** Vault display name, for prose. */
  vaultName: string | null;
  /** The loader manifest — one file, ready to copy. */
  manifest: InstallManifest;
}

/**
 * Resolve the vault's bootstrap skill as an installable loader.
 *
 * Returns `null` for every "not available" case — no `skills.bootstrap`
 * configured, node missing, node not a skill, storage unreachable — so the caller
 * can fall back to the generic template. The docs page is informational; a vault
 * hiccup should not 500 it.
 */
export async function resolveBootstrapSkill(
  serverAlias: string,
): Promise<ResolvedBootstrapSkill | null> {
  const vaultId = process.env.CONTEXTNEST_DEFAULT_VAULT_ID ?? 'default';
  try {
    const { storage } = createEngine('');
    const skillsConfig = await readSkillsConfig(storage);
    if (!skillsConfig?.bootstrap) return null;

    const doc = await storage.readDocument(skillsConfig.bootstrap);
    const config = await storage.readConfig();

    const manifest = buildInstallManifest(doc, {
      harness: 'claude-code',
      scope: 'user',
      mode: 'loader',
      serverAlias,
      vaultId,
      vaultName: config?.name,
    });

    return {
      path: skillsConfig.bootstrap,
      title: doc.frontmatter.title,
      vaultName: config?.name ?? null,
      manifest,
    };
  } catch (err) {
    // Informational page — degrade to the generic template rather than 500,
    // but leave a server-side trace so a misconfigured skills.bootstrap is
    // diagnosable instead of silently invisible.
    console.warn('[docs] could not resolve the vault bootstrap skill:', err);
    return null;
  }
}
