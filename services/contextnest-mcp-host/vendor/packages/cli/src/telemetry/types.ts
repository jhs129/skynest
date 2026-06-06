/**
 * Telemetry type definitions for Context Nest CLI.
 * Telemetry is opt-in and never transmits vault content — only metadata events.
 */

export interface TelemetryEvent {
  event:
    | "vault_initialized"
    | "starter_used"
    | "document_created"
    | "document_published"
    | "context_queried"
    | "pack_used"
    | "vault_verified";
  properties?: Record<string, string | number | boolean>;
}

export interface TelemetryPayload {
  client_id: string;
  cli_version: string;
  os: string;
  node_version: string;
  event: string;
  properties: Record<string, string | number | boolean>;
  timestamp: string;
}
