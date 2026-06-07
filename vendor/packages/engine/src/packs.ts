/**
 * Context Pack loading and expansion (§3).
 */

import type { Pack } from "./types.js";

/**
 * PackLoader manages loading and resolving packs.
 */
export class PackLoader {
  private packs: Map<string, Pack>;

  constructor(packs: Pack[]) {
    this.packs = new Map();
    for (const pack of packs) {
      this.packs.set(pack.id, pack);
    }
  }

  /** Get a pack by id */
  get(id: string): Pack | undefined {
    return this.packs.get(id);
  }

  /** List all packs */
  list(): Pack[] {
    return [...this.packs.values()];
  }

  /** Check if a pack exists */
  has(id: string): boolean {
    return this.packs.has(id);
  }
}
