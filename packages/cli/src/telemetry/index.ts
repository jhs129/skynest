/**
 * Lightweight, opt-in telemetry for Context Nest CLI.
 *
 * - Reads `.context/config.yaml` for `telemetry: true`.
 * - Never sends vault content — only metadata events.
 * - All network calls are fire-and-forget; never block the CLI or throw.
 * - Uses native `fetch` (Node 20+).
 * - Zero external dependencies.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TelemetryEvent, TelemetryPayload } from "./types.js";

export type { TelemetryEvent, TelemetryPayload } from "./types.js";

const CLI_VERSION = "0.3.0";
const DEFAULT_ENDPOINT = "https://api.promptowl.ai/v1/telemetry";

let enabled = false;
let clientId: string | undefined;
let endpoint: string = DEFAULT_ENDPOINT;
const queue: TelemetryPayload[] = [];

/**
 * Initialize telemetry — reads config, caches enabled state.
 * Safe to call multiple times; only the first call has effect.
 */
export async function initTelemetry(vaultRoot: string): Promise<void> {
  try {
    if (clientId !== undefined) return;

    const configPath = path.join(vaultRoot, ".context", "config.yaml");
    if (!fs.existsSync(configPath)) {
      enabled = false;
      clientId = "";
      return;
    }

    const configContent = fs.readFileSync(configPath, "utf-8");
    if (!/^telemetry:\s*true\s*$/m.test(configContent)) {
      enabled = false;
      clientId = "";
      return;
    }

    enabled = true;
    endpoint = process.env.CONTEXTNEST_TELEMETRY_URL || DEFAULT_ENDPOINT;
    clientId = await resolveClientId(vaultRoot);
  } catch {
    enabled = false;
    clientId = "";
  }
}

/**
 * Track an event. Enqueues the payload; never throws.
 */
export function track(event: TelemetryEvent): void {
  try {
    if (!enabled || !clientId) return;

    queue.push({
      client_id: clientId,
      cli_version: CLI_VERSION,
      os: process.platform,
      node_version: process.version,
      event: event.event,
      properties: event.properties ?? {},
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Never throw
  }
}

/**
 * Flush pending events. Call before process exit. Fire-and-forget.
 */
export async function flush(): Promise<void> {
  try {
    if (!enabled || queue.length === 0) return;

    const pending = queue.splice(0);
    const sends = pending.map((payload) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {}),
    );

    await Promise.allSettled(sends);
  } catch {
    // Never throw
  }
}

async function resolveClientId(vaultRoot: string): Promise<string> {
  const clientIdPath = path.join(vaultRoot, ".context", ".client_id");

  try {
    const existing = fs.readFileSync(clientIdPath, "utf-8").trim();
    if (existing.length > 0) return existing;
  } catch {
    // Doesn't exist yet
  }

  const id = randomUUID();
  fs.mkdirSync(path.dirname(clientIdPath), { recursive: true });
  fs.writeFileSync(clientIdPath, id, "utf-8");
  return id;
}
