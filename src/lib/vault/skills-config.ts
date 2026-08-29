/**
 * Vault-designated skill entry points, read from `.context/config.yaml`:
 *
 * ```yaml
 * skills:
 *   bootstrap: nodes/execution/skills/context-layer-bootstrap
 * ```
 *
 * Read raw rather than through `storage.readConfig()`: the engine's config schema
 * is upstream and strips keys it does not know, so `skills` would vanish on parse.
 * Keeping the read here also keeps the vendored engine free of a Skynest-only key.
 */

import yaml from 'js-yaml';
import type { NestStorage } from '@promptowl/contextnest-engine';

export interface VaultSkillsConfig {
  /** Node path of the skill that explains how to use this vault. */
  bootstrap?: string;
}

const CONFIG_PATH = '.context/config.yaml';

/**
 * Read the `skills:` block. Returns `null` when the vault configures none.
 *
 * Never throws: this feeds `vault_info`, and a malformed or unreadable config
 * should degrade to "no designated skill" rather than break vault orientation.
 * A genuinely broken config surfaces through `readConfig()` on the same call.
 */
export async function readSkillsConfig(storage: NestStorage): Promise<VaultSkillsConfig | null> {
  let raw: string;
  try {
    const buf = await storage.provider.read(CONFIG_PATH);
    if (buf === null) return null;
    raw = buf.toString('utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const skills = (parsed as { skills?: unknown }).skills;
  if (!skills || typeof skills !== 'object') return null;

  const bootstrap = (skills as { bootstrap?: unknown }).bootstrap;
  if (typeof bootstrap !== 'string' || !bootstrap.trim()) return null;

  return { bootstrap: bootstrap.trim().replace(/\.md$/, '') };
}
