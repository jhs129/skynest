import { z } from 'zod';

/**
 * Core type definitions for the Context Nest Specification v3.
 * See CONTEXT_NEST_SPEC-v3.md for the full specification.
 */
/** Node types (§1.6) */
type NodeType = "document" | "snippet" | "glossary" | "persona" | "prompt" | "source" | "tool" | "reference" | "skill";
/** Document status (§1.5) */
type Status = "draft" | "published";
/** Source transport protocol (§1.9.1) */
type Transport = "mcp" | "rest" | "cli" | "function";
/** Federation modes (§4.0) */
type FederationMode = "none" | "federated" | "scoped";
/** Governance tier (zone-classification-rbac-spec §1, §2.2) */
type GovernanceTier = "primary" | "standard";
/** Origin of a staged suggestion (bridge-function-spec Story 3.1, Story 1.3) */
type SuggestionSource = "out-of-band-edit" | "remote-push" | "manual-suggestion" | "quarantine";
/** Hash chain event taxonomy (zone-classification-rbac-spec §6, hootie-inbox-spec §8) */
type HashChainEventType = "primary.approved" | "primary.rejected" | "primary.rolled_back" | "primary.force_pushed" | "primary.force_push_acknowledged" | "standard.owner_approved" | "standard.owner_altered" | "standard.owner_rolled_back" | "dream.proposed" | "dream.approved" | "dream.rejected" | "dream.blocked_cross_zone" | "todo.delegated" | "zone.created" | "zone.deleted" | "czar.appointed" | "czar.removed" | "czar.vacancy_declared" | "permission.granted" | "permission.revoked" | "permission.self_granted" | "zone_challenge.raised" | "zone_challenge.resolved" | "reclassification.approved" | "reclassification.rejected" | "bridge_document.created" | "manifest.updated" | "platform_admin.toggle_changed" | "platform_admin.session_opened" | "platform_admin.session_closed" | "agent.zone_scope_assigned";
/** Source metadata block — present only on type: source nodes (§1.9.1) */
interface SourceMeta {
    transport: Transport;
    server?: string;
    tools: string[];
    depends_on?: string[];
    cache_ttl?: number;
}
/** Skill input parameter definition (§1.10) */
interface SkillInput {
    name: string;
    type: "string" | "number" | "boolean" | "array" | "object";
    description?: string;
    required?: boolean;
    default?: unknown;
}
/** Skill metadata block — present only on type: skill nodes (§1.10) */
interface SkillMeta {
    /** When this skill should be invoked (natural language trigger) */
    trigger: string;
    /** Input parameters the skill accepts */
    inputs?: SkillInput[];
    /** MCP tools or capabilities required to execute this skill */
    tools_required?: string[];
    /** Expected output format */
    output_format?: "markdown" | "json" | "text" | "code";
    /** Guard rails or constraints for execution */
    guard_rails?: string[];
}
/** YAML frontmatter for a Context Nest document (§1.3–1.5) */
interface Frontmatter {
    title: string;
    description?: string;
    type?: NodeType;
    tags?: string[];
    status?: Status;
    version?: number;
    author?: string;
    created_at?: string;
    updated_at?: string;
    derived_from?: string[];
    checksum?: string;
    metadata?: Record<string, unknown>;
    source?: SourceMeta;
    skill?: SkillMeta;
    /** Zone ID (zone-classification-rbac-spec §2.1 Level 2 metadata override) */
    zone?: string;
    /** Governance tier (zone-classification-rbac-spec §1) */
    governance?: GovernanceTier;
}
/** A parsed Context Nest document */
interface ContextNode {
    /** Relative path without .md extension, e.g. "nodes/api-design" */
    id: string;
    /** Absolute file path */
    filePath: string;
    /** Parsed and validated frontmatter */
    frontmatter: Frontmatter;
    /** Markdown body (everything after frontmatter closing ---) */
    body: string;
    /** Full raw file content */
    rawContent: string;
    /**
     * Set when live file bytes differ from the last-approved canonical content
     * (bridge-function-spec Story 3.1, hootie-inbox-spec §4.2). When present,
     * `frontmatter` and `body` reflect the approved state, NOT live bytes.
     */
    pendingChange?: PendingChange;
}
/**
 * Captured drift between live file bytes and the last-approved canonical
 * content. Surfaces on `ContextNode` and is durably represented in the
 * `_suggestions/` patch + meta files (bridge-function-spec Story 3.1).
 */
interface PendingChange {
    suggestion_id: string;
    detected_at: string;
    source: SuggestionSource;
    proposed_hash: string;
}
/**
 * Suggestion metadata persisted alongside the patch file in
 * `_suggestions/{doc}-{ts}-{hash}.meta.yaml`. One per staged change.
 * (bridge-function-spec Story 3.1, hootie-inbox-spec §4.1)
 */
interface SuggestionMeta {
    suggestion_id: string;
    document_id: string;
    zone?: string;
    doc_tier: GovernanceTier;
    source: SuggestionSource;
    actor: string;
    detected_at: string;
    /** Content hash of the last-approved canonical state (the chain head) */
    target_hash: string;
    /** Content hash of the proposed/drifted content */
    proposed_hash: string;
    /** Relative path to the patch file under `_suggestions/` */
    patch_path: string;
    note?: string;
}
/**
 * Immutable governance event in the PESWG hash chain
 * (zone-classification-rbac-spec §6, hootie-inbox-spec §8). Emitted ONLY on
 * approval-class actions — never on drift detection or informational dismissal.
 */
interface HashChainEvent {
    event_id: string;
    event_type: HashChainEventType;
    timestamp: string;
    actor: string;
    zone?: string;
    document_id?: string;
    /** Resulting document chain hash, when the event mutates document state */
    resulting_hash?: string;
    action_metadata?: Record<string, unknown>;
    signature?: string;
}
/**
 * RBAC policy hook injected by the bridge layer. Engine stays identity-
 * agnostic; the bridge supplies the real implementation
 * (zone-classification-rbac-spec §4, Story 6.2).
 */
interface RbacHook {
    isCzar(actor: string, zoneId: string): boolean | Promise<boolean>;
    canIngest(actor: string, zoneId: string): boolean | Promise<boolean>;
    isDocOwner(actor: string, documentId: string): boolean | Promise<boolean>;
}
/** Relationship edge types (§5.1) */
type EdgeType = "reference" | "depends_on";
/** A relationship edge in context.yaml */
interface RelationshipEdge {
    from: string;
    to: string;
    type: EdgeType;
    /** Edge traversal cost: 0 = always traverse (free hop), higher = more costly. Default: 1 for reference, 0 for depends_on. */
    priority?: number;
}
/** Hub entry in context.yaml */
interface HubEntry {
    id: string;
    degree: number;
}
/** MCP server entry in external_dependencies */
interface ExternalServer {
    name: string;
    url: string;
    used_by: string[];
}
/** Document entry in context.yaml */
interface ContextYamlDocument {
    id: string;
    title: string;
    description?: string;
    type: NodeType;
    tags: string[];
    status: Status;
    version: number;
    source?: {
        transport: Transport;
        server?: string;
        tools: string[];
        depends_on?: string[];
        cache_ttl?: number;
    };
    skill?: {
        trigger: string;
        tools_required?: string[];
        output_format?: string;
    };
}
/** The auto-generated context.yaml (§5) */
interface ContextYaml {
    version: number;
    generated_at: string;
    checkpoint: number;
    checkpoint_at: string;
    namespace?: string;
    federation?: FederationMode;
    documents: ContextYamlDocument[];
    relationships: RelationshipEdge[];
    hubs: HubEntry[];
    external_dependencies: {
        mcp_servers: ExternalServer[];
    };
}
/** Version entry in history.yaml (§6.2) */
interface VersionEntry {
    version: number;
    keyframe?: boolean;
    diff?: string;
    edited_by: string;
    edited_at: string;
    published_at?: string;
    note?: string;
    content_hash: string;
    chain_hash: string;
}
/** Document history file (§6.2) */
interface DocumentHistory {
    keyframe_interval: number;
    versions: VersionEntry[];
}
/** Checkpoint entry in context_history.yaml (§7.2) */
interface Checkpoint {
    checkpoint: number;
    at: string;
    triggered_by: string;
    document_versions: Record<string, number>;
    document_chain_hashes: Record<string, string>;
    checkpoint_hash: string;
}
/** Checkpoint history file (§7.2) */
interface CheckpointHistory {
    checkpoints: Checkpoint[];
}
/** Nest configuration from .context/config.yaml (§11.1) */
interface NestConfig {
    version: number;
    name: string;
    description?: string;
    defaults?: {
        status?: Status;
    };
    folders?: Record<string, {
        description?: string;
        template?: string;
    }>;
    servers?: Record<string, {
        url: string;
        transport: Transport;
        description?: string;
    }>;
    sync?: {
        promptowl_data_room_id?: string;
        auto_index?: boolean;
    };
    /**
     * Agent maintenance directive — emitted into the managed section of
     * CLAUDE.md / GEMINI.md / .cursorrules / .windsurfrules /
     * .github/copilot-instructions.md by `ctx index`. Tells the agent
     * working with this vault that it's responsible for keeping the nest
     * useful (capturing new information, decisions, gotchas) without
     * waiting to be asked. Set per-starter at init time. If absent at
     * index time, a sensible default is used.
     */
    agent_maintenance_directive?: string;
}
/** Trace entry for document access (§9.2) */
interface AccessTrace {
    trace_type: "access";
    document_ref: string;
    document_version: number;
    checkpoint: number;
    author?: string;
    edited_at?: string;
    accessed_at: string;
}
/** Trace entry for source hydration (§9.3) */
interface SourceHydrationTrace {
    trace_type: "source_hydration" | "source_cache_hit" | "source_failure";
    source_ref: string;
    source_version: number;
    checkpoint: number;
    tools_called: string[];
    server?: string;
    result_hash?: string;
    result_size?: number;
    cache_hit: boolean;
    duration_ms?: number;
    error?: string;
}
type TraceEntry = AccessTrace | SourceHydrationTrace;
/** Validation error */
interface ValidationError {
    rule: number;
    path: string;
    message: string;
    field?: string;
}
/** Validation result */
interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}
/** Pack definition (§3.3) */
interface Pack {
    id: string;
    label: string;
    description?: string;
    query?: string;
    includes?: string[];
    excludes?: string[];
    filters?: {
        node_types?: NodeType[];
    };
    agent_instructions?: string;
    audiences?: string[];
}
/** Parsed contextnest:// URI (§4.1) */
interface ContextNestUri {
    namespace?: string;
    path: string;
    checkpoint?: number;
    anchor?: string;
    kind: "document" | "tag" | "folder" | "search";
}
/** Result from resolving a URI or selector */
interface ResolvedResult {
    documents: ContextNode[];
    sourceNodes: ContextNode[];
    agentInstructions?: string;
    traces: TraceEntry[];
}
/** Options for graph traversal */
interface TraversalOptions {
    /** Maximum hops from seed nodes (default: 2) */
    maxHops: number;
    /** Adaptive: retry with more hops if result set is below this count (default: 1) */
    minResults?: number;
    /** Maximum hops for adaptive expansion (default: 5) */
    maxAdaptiveHops?: number;
}
/** Result of a graph traversal */
interface TraversalResult {
    /** Node IDs reached by traversal */
    nodeIds: Set<string>;
    /** Actual hops used (may be higher than maxHops if adaptive expansion kicked in) */
    hopsUsed: number;
    /** Total edges followed during traversal */
    edgesTraversed: number;
}
/** Extended result with traversal metadata */
interface GraphQueryResult extends ResolvedResult {
    /** Hops used in graph traversal */
    hopsUsed: number;
    /** Number of nodes reached */
    nodesTraversed: number;
    /** Query mode used */
    mode: "graph" | "full";
}
/** Verification report for integrity checks (§8.4) */
interface VerificationReport {
    valid: boolean;
    errors: Array<{
        type: "content_hash_mismatch" | "chain_hash_mismatch" | "cross_chain_mismatch" | "checkpoint_hash_mismatch" | "body_drift";
        document?: string;
        version?: number;
        checkpoint?: number;
        expected: string | null;
        actual: string;
    }>;
}

/** Structured error types for the Context Nest engine */
declare class ContextNestError extends Error {
    readonly code: string;
    readonly specSection?: string | undefined;
    constructor(message: string, code: string, specSection?: string | undefined);
}
declare class ValidationFailedError extends ContextNestError {
    readonly rule: number;
    readonly field?: string | undefined;
    constructor(message: string, rule: number, field?: string | undefined);
}
declare class DocumentNotFoundError extends ContextNestError {
    readonly documentId: string;
    constructor(documentId: string);
}
declare class InvalidUriError extends ContextNestError {
    readonly uri: string;
    constructor(uri: string, reason: string);
}
declare class CircularDependencyError extends ContextNestError {
    readonly cycle: string[];
    constructor(cycle: string[]);
}
declare class IntegrityError extends ContextNestError {
    readonly mismatchType: "content_hash_mismatch" | "chain_hash_mismatch" | "cross_chain_mismatch" | "checkpoint_hash_mismatch";
    constructor(message: string, mismatchType: "content_hash_mismatch" | "chain_hash_mismatch" | "cross_chain_mismatch" | "checkpoint_hash_mismatch");
}
declare class FederationNotSupportedError extends ContextNestError {
    readonly mode: string;
    constructor(mode: string);
}
declare class ConfigError extends ContextNestError {
    constructor(message: string);
}
/**
 * Raised when a document's frontmatter-declared zone contradicts its
 * folder-implied zone (zone-classification-rbac-spec §2.4). Per spec, the
 * document remains injectable; the Czar resolves via the Inbox.
 */
declare class ZoneChallengeError extends ContextNestError {
    readonly documentId: string;
    readonly declaredZone: string;
    readonly impliedZone: string;
    constructor(documentId: string, declaredZone: string, impliedZone: string);
}
/**
 * Raised when an offline-revoked user's pushed delta is intercepted and must
 * be quarantined for Czar review (bridge-function-spec Story 1.3). The delta
 * is never auto-merged.
 */
declare class QuarantineError extends ContextNestError {
    readonly documentId: string;
    readonly reason: string;
    constructor(documentId: string, reason: string);
}
/**
 * Raised when an actor attempts a governance action they are not authorized
 * for under the injected `RbacHook` (zone-classification-rbac-spec §4,
 * Story 6.2). Engine never assumes identity — the bridge supplies RBAC.
 */
declare class UnauthorizedActionError extends ContextNestError {
    readonly actor: string;
    readonly action: string;
    readonly zone?: string | undefined;
    constructor(actor: string, action: string, zone?: string | undefined);
}
/**
 * Raised when an incoming remote delta's `previous_chain_hash` does not
 * link to the local chain head for the target document
 * (bridge-function-spec §367). The delta is rejected — caller decides
 * merge strategy.
 */
declare class ChainBreakError extends ContextNestError {
    readonly documentId: string;
    readonly expectedPrevHash: string;
    readonly actualPrevHash: string;
    constructor(documentId: string, expectedPrevHash: string, actualPrevHash: string);
}

/**
 * RBAC enforcement primitives for the Context Nest engine.
 *
 * The engine is identity-agnostic by design (zone-classification-rbac-spec
 * §4, bridge-function-spec Story 6.2). It never assumes who the actor is or
 * what permissions they hold; the bridge layer supplies an `RbacHook`
 * implementation that wraps the org's real identity/permission service.
 *
 * What lives here:
 *   - `denyAllRbac`: a safe default that denies every operation. Used when
 *     no hook is supplied so unwrapped engine usage cannot escalate.
 *   - `requireCzar` / `requireIngest` / `requireDocOwner`: small assertion
 *     helpers that throw `UnauthorizedActionError` on a denied check.
 *
 * Engine code that performs a governance-class action (approve, reject,
 * rollback, force-push, dream-approve, classification-manifest-update, etc.)
 * MUST route the permission decision through one of these helpers — it must
 * NOT inspect actor strings, role tables, or anything identity-shaped.
 */

/**
 * Default-deny RBAC hook. Every check returns `false`.
 *
 * This is the engine's safe baseline: if no bridge-supplied hook is wired
 * up, governance-class operations cannot succeed. The engine never assumes
 * an unauthenticated context is trusted.
 */
declare const denyAllRbac: RbacHook;
/**
 * Assert the actor is the Czar of the given zone. Throws
 * `UnauthorizedActionError` otherwise.
 *
 * Use before any action listed under zone-classification-rbac-spec §5.4
 * "Czar authorities" — approve/reject primary changes, grant/revoke
 * ingest, trigger force push, approve dream proposals, resolve zone
 * challenges, edit the classification manifest, etc.
 */
declare function requireCzar(hook: RbacHook, actor: string, zoneId: string, action: string): Promise<void>;
/**
 * Assert the actor has ingest permission for the given zone. Throws
 * `UnauthorizedActionError` otherwise.
 *
 * Per zone-classification-rbac-spec §4.1, ingest is the single, binary
 * permission. If you do not have ingest on a zone, the zone does not exist
 * for you — never enumerate documents, never resolve URIs, never include
 * docs in scanner results (Story 4.2 negative test, Story 6.2).
 */
declare function requireIngest(hook: RbacHook, actor: string, zoneId: string, action: string): Promise<void>;
/**
 * Assert the actor owns the document. Throws `UnauthorizedActionError`
 * otherwise.
 *
 * Use before Standard Document owner-only actions: approve, alter, or
 * rollback an incoming change notification (hootie-inbox-spec §4.2).
 */
declare function requireDocOwner(hook: RbacHook, actor: string, documentId: string, action: string): Promise<void>;
/**
 * Filter a list of zone IDs down to the subset the actor can ingest.
 *
 * Used by the background scanner / hygienist before traversing zones — per
 * Story 4.2 negative test, the scanner MUST NOT cross zone boundaries to
 * find content the user lacks ingest permission for. Zones the actor
 * cannot ingest are silently elided; zone existence is not disclosed
 * (§3.2 isolation by default).
 */
declare function filterIngestibleZones(hook: RbacHook, actor: string, zoneIds: readonly string[]): Promise<string[]>;

/**
 * SHA-256 hash chain computation and verification (§8).
 */

/**
 * Normalize content before hashing to tolerate cloud-sync byte mutations.
 * Strips UTF-8 BOM and normalizes line endings to LF.
 */
declare function normalizeForHash(content: string): string;
/**
 * Compute SHA-256 hash of a string, returning sha256:<hex> format.
 */
declare function sha256(input: string): string;
/**
 * Compute content_hash for a version entry (§8.2).
 * - Keyframe: SHA-256 of the full snapshot file content
 * - Diff: SHA-256 of the diff string
 *
 * Content is normalized (BOM stripped, line endings → LF) before hashing
 * so that cloud-sync byte mutations do not break integrity chains.
 */
declare function computeContentHash(content: string): string;
/**
 * Compute chain_hash for a version entry (§8.2).
 *
 * chain_hash[n] = SHA-256(
 *   chain_hash[n-1] + ":" +
 *   content_hash[n] + ":" +
 *   version[n]      + ":" +
 *   edited_by[n]    + ":" +
 *   edited_at[n]
 * )
 *
 * For the first entry, chain_hash[n-1] is replaced by the genesis sentinel.
 */
declare function computeChainHash(previousChainHash: string | null, contentHash: string, version: number, editedBy: string, editedAt: string): string;
/**
 * Compute checkpoint_hash (§8.3).
 *
 * checkpoint_hash[n] = SHA-256(
 *   checkpoint_hash[n-1]    + ":" +
 *   checkpoint[n]           + ":" +
 *   at[n]                   + ":" +
 *   triggered_by[n]         + ":" +
 *   canonical_versions[n]   + ":" +
 *   canonical_chain_hashes[n]
 * )
 */
declare function computeCheckpointHash(previousCheckpointHash: string | null, checkpoint: number, at: string, triggeredBy: string, documentVersions: Record<string, number>, documentChainHashes: Record<string, string>): string;
/**
 * Serialize an object as JSON with sorted keys and no whitespace (§8.3).
 */
declare function canonicalJson(obj: Record<string, unknown>): string;
/**
 * Result of comparing live file bytes against a stored checksum.
 *
 * `drifted` is true only when a stored checksum exists and disagrees with
 * the recomputed content hash. Legacy documents with no stored checksum
 * report `drifted: false` (engine treats absence as "not yet tracked").
 */
interface DriftReport {
    drifted: boolean;
    /** The checksum read from frontmatter, or null if the document has none */
    storedHash: string | null;
    /** SHA-256 of the current body content, normalized */
    actualHash: string;
}
/**
 * Pure drift detection. No I/O, no mutations.
 *
 * Caller hands in the live raw file content and the stored frontmatter
 * checksum. Engine recomputes the body hash (same input as
 * `publishDocument` writes — body only, normalized) and reports.
 *
 * This is the detection chokepoint for the spec's out-of-band edit case
 * (bridge-function-spec Story 3.1, Story 2.1 "intercepts contradictory
 * state during checkpointing"). The function itself does NOT stage a
 * suggestion or mutate the chain — that is the job of the suggestions /
 * approval modules wired in later steps.
 */
declare function detectDrift(rawContent: string, storedChecksum: string | null | undefined): DriftReport;
/** Input to `verifyRemoteDelta`. */
interface RemoteDeltaInput {
    /** Document ID this delta targets (for error context only) */
    documentId: string;
    /** Raw bytes of the incoming document payload (frontmatter + body) */
    rawContent: string;
    /** Content hash the remote claims for `rawContent` */
    declaredChecksum: string;
    /**
     * Previous chain head the remote believes it is building on. `null` =
     * remote claims this is the first version (genesis case).
     */
    declaredPrevChainHash: string | null;
    /**
     * Local chain head currently known for this document. `null` = local has
     * no record of this document yet (acceptable only when the remote also
     * claims genesis).
     */
    localPrevChainHash: string | null;
}
/** Result of `verifyRemoteDelta`. Caller decides reject / quarantine / merge. */
interface RemoteDeltaVerification {
    ok: boolean;
    /** Engine-computed content hash for `rawContent` */
    computedHash: string;
    errors: Array<{
        type: "content_hash_mismatch";
        expected: string;
        actual: string;
    } | {
        type: "chain_break";
        expectedPrevChainHash: string | null;
        actualPrevChainHash: string | null;
    }>;
}
/**
 * Verify a remote-pushed document delta before it is staged or persisted.
 *
 * Spec contract (bridge-function-spec §367, Success Criteria):
 *   "Context can be pushed from desktop to cloud without corrupting hash
 *    chain."
 *
 * Two checks:
 *   1. Content hash — the remote's declared checksum must match the bytes
 *      it sent (transport / tamper detection).
 *   2. Chain continuity — the remote's `declaredPrevChainHash` must equal
 *      the local chain head for the document; otherwise the chain has
 *      forked and the caller must decide whether to quarantine the delta
 *      (bridge-function-spec Story 1.3) or merge.
 *
 * The function never throws on verification failure — it returns a
 * structured result so the bridge can route per spec (quarantine vs.
 * three-way merge vs. reject). Wrap the result with `chainBreakErrorFrom`
 * or check `ok` at the call site.
 */
declare function verifyRemoteDelta(input: RemoteDeltaInput): RemoteDeltaVerification;
/**
 * Verify the integrity of a document's version chain (§8.4 steps 2-3).
 */
declare function verifyDocumentChain(docId: string, history: DocumentHistory, readKeyframe: (version: number) => string | null): VerificationReport;
/**
 * Verify the integrity of the checkpoint chain (§8.4 steps 4-5).
 */
declare function verifyCheckpointChain(checkpoints: Checkpoint[], documentHistories: Map<string, DocumentHistory>): VerificationReport;

interface StorageProvider {
    /** Read a vault-relative path. Returns null if the file does not exist. */
    read(path: string): Promise<Buffer | null>;
    /** Write data to a vault-relative path. Creates parent directories as needed. */
    write(path: string, data: Buffer): Promise<void>;
    /** Delete a file at a vault-relative path. No-op if it does not exist. */
    delete(path: string): Promise<void>;
    /** Recursively delete all files under a vault-relative directory prefix. */
    deleteDir(prefix: string): Promise<void>;
    /** Move a file from one vault-relative path to another. */
    rename(from: string, to: string): Promise<void>;
    /**
     * List vault-relative paths matching a glob pattern.
     * Returns paths relative to the vault root (e.g. "nodes/doc.md").
     */
    list(pattern: string): Promise<string[]>;
    /** Return true if a file exists at the given vault-relative path. */
    exists(path: string): Promise<boolean>;
}

/**
 * File system abstraction for vault operations.
 * Supports both structured and Obsidian-compatible layouts (§1.1).
 *
 * All I/O is delegated to a StorageProvider so that the class can run
 * against any backend (local fs, Vercel Blob, in-memory test double, etc.).
 *
 * Backward-compatible constructor overload:
 *   new NestStorage(root)          — creates an FsStorageProvider internally
 *   new NestStorage(provider)      — uses the supplied provider directly
 */

/** Sentinel suggestion_id used before a drift has been staged into `_suggestions/`. */
declare const UNSTAGED_DRIFT_SENTINEL = "unstaged-drift";
/** Options for `NestStorage.readDocument`. */
interface ReadDocumentOptions {
    /**
     * When true, recompute the body hash and compare against the stored
     * frontmatter checksum (bridge-function-spec Story 3.1, Story 2.1).
     *
     * On drift:
     *   - If a last-approved keyframe exists for the document, the returned
     *     `ContextNode` contains the APPROVED content — never the live
     *     drifted bytes (hootie-inbox-spec §4.2: "document remains at last
     *     approved state for injection purposes").
     *   - A `pendingChange` field is attached pointing at the drifted hash.
     *     If no staged suggestion exists yet, `suggestion_id` is
     *     `UNSTAGED_DRIFT_SENTINEL`; the suggestions module will overwrite it
     *     when the drift is staged.
     *   - If no keyframe is available (legacy doc with no version history),
     *     the live bytes are returned with `pendingChange` attached so the
     *     caller is at least aware of the drift.
     *
     * Default: false (backward compatible — no behavior change for existing
     * callers that just want raw parsed bytes).
     */
    verifyChecksum?: boolean;
}
type LayoutMode = "structured" | "obsidian";
declare class NestStorage {
    private readonly provider;
    readonly root: string;
    constructor(rootOrProvider: string | StorageProvider);
    /**
     * Detect layout mode. If nodes/ directory exists, structured; otherwise Obsidian.
     */
    detectLayout(): Promise<LayoutMode>;
    /**
     * Discover all markdown documents in the vault.
     * Skips hidden directories (.-prefixed) and node_modules.
     */
    discoverDocuments(): Promise<ContextNode[]>;
    /**
     * Read a single document by its id (relative path without .md).
     *
     * Default behavior (no options): reads the live `.md` file and returns
     * the parsed node verbatim. Backward-compatible with all existing callers.
     *
     * With `verifyChecksum: true`: detects out-of-band edits per
     * bridge-function-spec Story 3.1 + Story 2.1. On drift the returned
     * node carries the last-approved canonical content (never the drifted
     * live bytes — hootie-inbox-spec §4.2) plus a `pendingChange` flag.
     */
    readDocument(id: string, options?: ReadDocumentOptions): Promise<ContextNode>;
    /**
     * Compute drift for a document without touching the live file (read-only).
     * Returns `null` when the document does not exist.
     *
     * Useful for the checkpoint hook and background hygienist (step 9 / 10).
     */
    detectDocumentDrift(id: string): Promise<ReturnType<typeof detectDrift> | null>;
    /**
     * Regenerate derived vault files after any mutation: context.yaml,
     * per-folder INDEX.md, and agent-config files (CLAUDE.md, GEMINI.md,
     * .cursorrules, etc.).
     *
     * Single source for mcp-server, cli, and desktop. Each agent-config file
     * is merged with its existing on-disk content so user-authored sections
     * outside engine-managed blocks are preserved.
     */
    regenerateIndex(): Promise<void>;
    /**
     * Full vault integrity check: document chains, checkpoint chain, and
     * live-body drift against stored frontmatter checksums.
     *
     * Single entry point used by mcp-server, cli, desktop. Detects:
     *   - content_hash_mismatch / chain_hash_mismatch in version history
     *   - cross_chain_mismatch / checkpoint_hash_mismatch in checkpoints
     *   - body_drift when live `.md` body sha256 != frontmatter.checksum
     */
    verifyVaultIntegrity(): Promise<VerificationReport>;
    /**
     * Return the most recent keyframe content for a document, if any.
     * Walks the history backward looking for the last `keyframe: true` entry
     * with an extant `v{N}.md` file. Returns `null` for legacy docs with no
     * history or no keyframes on disk.
     */
    readLatestApprovedKeyframe(id: string): Promise<{
        version: number;
        content: string;
    } | null>;
    /**
     * Write a document to disk.
     */
    writeDocument(id: string, content: string): Promise<void>;
    /**
     * Delete a document and its version history from the vault.
     */
    deleteDocument(id: string): Promise<void>;
    /**
     * Batch-read documents by ID. Only loads bodies for requested IDs.
     * Parallelizes reads for performance. Missing documents are silently skipped.
     */
    readDocuments(ids: string[]): Promise<Map<string, ContextNode>>;
    /**
     * Read CONTEXT.md vault identity file (§1.2).
     */
    readContextMd(): Promise<string | null>;
    /**
     * Read .context/config.yaml (§11.1).
     */
    readConfig(): Promise<NestConfig | null>;
    /**
     * Read context.yaml (§5).
     */
    readContextYaml(): Promise<ContextYaml | null>;
    /**
     * Write context.yaml.
     */
    writeContextYaml(data: ContextYaml): Promise<void>;
    /**
     * Read document history from .versions/{docName}/history.yaml (§6.2).
     */
    readHistory(docId: string): Promise<DocumentHistory | null>;
    /**
     * Write document history to .versions/{docName}/history.yaml.
     */
    writeHistory(docId: string, history: DocumentHistory): Promise<void>;
    /**
     * Read a keyframe version file.
     */
    readKeyframe(docId: string, version: number): Promise<string | null>;
    /**
     * Write a keyframe version file.
     */
    writeKeyframe(docId: string, version: number, content: string): Promise<void>;
    /**
     * Path layout for staged suggestions (bridge-function-spec Story 3.1):
     *
     *   {docDir}/_suggestions/{docName}/{suggestionId}.patch
     *   {docDir}/_suggestions/{docName}/{suggestionId}.meta.yaml
     *
     * Mirrors the `.versions/` layout for consistency.
     * Returns a vault-relative path prefix.
     */
    private suggestionDir;
    /** Write a unified-diff patch for a staged suggestion. */
    writeSuggestionPatch(docId: string, suggestionId: string, patch: string): Promise<string>;
    /** Write the YAML meta record for a staged suggestion. */
    writeSuggestionMeta(docId: string, suggestionId: string, meta: unknown): Promise<string>;
    /** Read a staged suggestion's patch text, or null when absent. */
    readSuggestionPatch(docId: string, suggestionId: string): Promise<string | null>;
    /** Read a staged suggestion's parsed meta, or null when absent. */
    readSuggestionMeta(docId: string, suggestionId: string): Promise<unknown | null>;
    /** List all suggestion IDs staged for a document, sorted by file name. */
    listSuggestionIds(docId: string): Promise<string[]>;
    /**
     * Move a staged suggestion's patch + meta files into the per-doc archive
     * (hootie-inbox-spec §7: governance history permanently retained).
     *
     * Layout: `{docDir}/_suggestions/{docName}/_archive/{kind}/{id}.{patch|meta.yaml}`.
     * Returns the absolute archive directory (or relative when root is empty).
     */
    archiveSuggestion(docId: string, suggestionId: string, kind: "approved" | "rejected"): Promise<string>;
    /**
     * Read checkpoint history from .versions/context_history.yaml (§7.2).
     */
    readCheckpointHistory(): Promise<CheckpointHistory | null>;
    /**
     * Write checkpoint history.
     */
    writeCheckpointHistory(history: CheckpointHistory): Promise<void>;
    /**
     * Path to the chain-events log file (zone-classification-rbac-spec §6,
     * hootie-inbox-spec §8). Lives alongside the checkpoint history.
     */
    private chainEventLogRelPath;
    /**
     * Read the raw chain-event log. Returns an empty array if the file is
     * absent or unreadable. Callers should validate entries via
     * `hashChainEventSchema` before consuming — this method does not
     * schema-check, to stay symmetric with the other low-level readers.
     */
    readChainEventLog(): Promise<unknown[]>;
    /**
     * Append a single chain event to the log. Atomic at the YAML-document
     * level (write a fresh full file each time). Caller is responsible for
     * ensuring the event is schema-valid.
     */
    appendChainEvent(event: unknown): Promise<void>;
    /**
     * Read all packs from packs/ directory (§3).
     */
    readPacks(): Promise<Pack[]>;
    /**
     * Write an INDEX.md file.
     */
    writeIndexMd(folder: string, content: string): Promise<void>;
    /**
     * Write CONTEXT.md.
     */
    writeContextMd(content: string): Promise<void>;
    /**
     * Write .context/config.yaml.
     */
    writeConfig(config: NestConfig): Promise<void>;
    /**
     * Find all document history files across the nest.
     * Used for checkpoint rebuild (§7.3).
     */
    findAllHistories(): Promise<Map<string, DocumentHistory>>;
    /**
     * Initialize a new vault with the given layout mode.
     */
    init(name: string, layout?: LayoutMode): Promise<void>;
}

interface StorageProviderConfig {
    backend: string;
    vaultPath?: string;
}
/**
 * Base factory — handles 'fs' only.
 * The 'blob' backend is registered in the host application (src/lib/vault/storage/index.ts)
 * to keep Vercel-specific dependencies out of the vendor tree.
 */
declare function createStorageProvider(config: StorageProviderConfig): StorageProvider;

declare class FsStorageProvider implements StorageProvider {
    private readonly root;
    constructor(root: string);
    private abs;
    read(path: string): Promise<Buffer | null>;
    write(path: string, data: Buffer): Promise<void>;
    delete(path: string): Promise<void>;
    deleteDir(prefix: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    list(pattern: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
}

/**
 * Suggestion staging — bridge-function-spec Story 3.1, hootie-inbox-spec §4.
 *
 * When the engine detects an out-of-band edit (or receives a remote-pushed
 * delta, or quarantines a revoked-user's offline edits), it captures the
 * change as a patch + meta record under `_suggestions/`. The canonical
 * document on disk and in the hash chain are **never** touched by this
 * module — they only change when an approval action commits a new version.
 *
 * Per spec:
 *   - Story 3.1: "ContextNest intercepts the change and routes it into the
 *     `_suggestions/` subfolder as a patch file instead of altering the
 *     canonical string. The canonical document remains untouched."
 *   - Hootie §4.2: "Until owner acts, document remains at last approved
 *     state for injection purposes. The proposed change is staged — it
 *     does not affect the live hash chain state."
 *   - Story 1.3: Revoked-user offline pushes are routed here with
 *     `source: "quarantine"` for Czar review.
 */

/** Input to `stageSuggestion`. */
interface StageSuggestionInput {
    storage: NestStorage;
    /** e.g. `"nodes/sales-playbook"` (no `.md` suffix). */
    documentId: string;
    /** Last-approved canonical bytes (typically the latest keyframe). */
    approvedRawContent: string;
    /** Bytes the user / remote wants to commit (live drifted file, push payload). */
    proposedRawContent: string;
    /** What surfaced this drift (Story 3.1 / Story 1.3 / etc.). */
    source: SuggestionSource;
    /** Opaque actor string (bridge supplies — engine never interprets). */
    actor: string;
    zone?: string;
    docTier: GovernanceTier;
    note?: string;
    /** ISO-8601 timestamp. Defaults to `new Date().toISOString()`. */
    detectedAt?: string;
    /**
     * Optional override for the suggestion ID. Tests use this for
     * determinism; production callers should let the function generate one.
     */
    suggestionId?: string;
}
/** Result of staging a suggestion. */
interface StageSuggestionResult {
    meta: SuggestionMeta;
    /** Absolute path to the written patch file. */
    patchPath: string;
    /** Absolute path to the written meta YAML file. */
    metaPath: string;
}
/**
 * Stage a proposed change as a patch + meta record under `_suggestions/`.
 *
 * Does NOT modify the canonical document or the hash chain. Idempotency is
 * filesystem-level: each call generates a unique suggestion ID (timestamp +
 * proposed-hash prefix), so re-staging the same drift on a different call
 * produces a separate record — by design, since detection time is part of
 * the audit trail.
 */
declare function stageSuggestion(input: StageSuggestionInput): Promise<StageSuggestionResult>;
/** Convenience wrapper that stages with `source: "quarantine"` (Story 1.3). */
declare function quarantineSuggestion(input: Omit<StageSuggestionInput, "source">): Promise<StageSuggestionResult>;
/** List all staged suggestion metas for a document, sorted by suggestion ID. */
declare function listSuggestions(storage: NestStorage, documentId: string): Promise<SuggestionMeta[]>;
/**
 * Read a single suggestion's meta + patch, or null when not found.
 * Returns the patch separately because the meta does not embed bytes.
 */
declare function readSuggestion(storage: NestStorage, documentId: string, suggestionId: string): Promise<{
    meta: SuggestionMeta;
    patch: string;
} | null>;

/**
 * Approval / rejection / rollback / Czar direct-edit primitives — the
 * only paths in the engine that mutate the hash chain or the canonical
 * live document.
 *
 * Spec coverage:
 *   - bridge-function-spec §5 Stages 2–4: gatekeeper approval, direct edit,
 *     publishing, audit trail
 *   - bridge-function-spec Story 3.2: gatekeeper approval workflow
 *   - bridge-function-spec Story 3.3: instant rollback
 *   - zone-classification-rbac-spec §6: every governance action emits a
 *     first-class hash chain event
 *   - hootie-inbox-spec §4.1 / §4.2 / §8: approve / reject / alter /
 *     rollback semantics and chain integration
 *
 * Engine guarantees:
 *   - No path here trusts the actor — every mutation routes through the
 *     injected `RbacHook` (`requireCzar` for Primary, `requireDocOwner` for
 *     Standard).
 *   - No path auto-merges a stale suggestion. If the chain head has moved
 *     since staging, the approval is refused with an `IntegrityError` so
 *     the caller can re-stage against the new head.
 *   - No suggestion data is ever deleted. Approved / rejected suggestions
 *     are moved (not unlinked) into `_archive/{approved|rejected}/`
 *     (hootie-inbox-spec §7 — governance history permanently retained).
 */

/** Inputs common to every governance action. */
interface BaseInput {
    storage: NestStorage;
    rbac: RbacHook;
    documentId: string;
    /** Opaque actor string supplied by the bridge. Engine never interprets. */
    actor: string;
    /** Zone the document belongs to. Required for the Czar gate (Primary tier). */
    zone: string;
}
interface ApproveSuggestionInput extends BaseInput {
    suggestionId: string;
    /** Optional approval comment recorded in the chain event audit metadata. */
    comment?: string;
}
interface ApprovalResult {
    versionEntry: VersionEntry;
    chainEvent: HashChainEvent;
    /** Absolute path to the archive directory the suggestion files were moved to. */
    archivedAt: string;
}
/**
 * Approve a staged suggestion: applies the patch, commits a new version,
 * writes the live canonical file, and archives the suggestion record.
 *
 * Refuses if the suggestion's `target_hash` no longer equals the current
 * chain head (suggestion is stale; caller must re-stage).
 */
declare function approveSuggestion(input: ApproveSuggestionInput): Promise<ApprovalResult>;
interface RejectSuggestionInput extends BaseInput {
    suggestionId: string;
    /** Required per bridge §5 Stage 3: rejection must carry a reason for audit. */
    reason: string;
}
interface RejectionResult {
    chainEvent: HashChainEvent;
    archivedAt: string;
}
/**
 * Reject a staged suggestion (bridge-function-spec §5 Stage 3, hootie §7).
 *
 * Canonical document and chain head are untouched. The suggestion files
 * are MOVED (not deleted) into `_archive/rejected/` — per spec, governance
 * history is permanently retained.
 */
declare function rejectSuggestion(input: RejectSuggestionInput): Promise<RejectionResult>;
interface RollbackInput extends BaseInput {
    /** Version to revert TO (must be a prior keyframe in history). */
    targetVersion: number;
    docTier: GovernanceTier;
    reason?: string;
}
interface RollbackResult {
    versionEntry: VersionEntry;
    chainEvent: HashChainEvent;
}
/**
 * One-click instant revert (bridge-function-spec Story 3.3, §5 Resolved §4).
 *
 * Rolls forward — the revert is recorded as a NEW version pointing at the
 * prior content. Prior versions are not erased; the chain reads cleanly
 * forward to the rollback entry, then to whatever comes after.
 */
declare function rollbackDocument(input: RollbackInput): Promise<RollbackResult>;
interface CzarDirectEditInput extends BaseInput {
    /**
     * The full new raw markdown content (frontmatter + body). The engine
     * recomputes the body checksum and bumps the version automatically.
     */
    newRawContent: string;
    note?: string;
}
interface CzarDirectEditResult {
    versionEntry: VersionEntry;
    chainEvent: HashChainEvent;
}
/**
 * Czar proactive direct edit (bridge-function-spec §5 Stage 2 Proactive).
 *
 * No suggestion layer. Czar's signature is auto-recorded. Subscribers see
 * it as a direct publication (chain event = `primary.approved`).
 */
declare function czarDirectEdit(input: CzarDirectEditInput): Promise<CzarDirectEditResult>;

/**
 * Three-level classification cascade and Zone Challenge detection
 * (zone-classification-rbac-spec §2).
 *
 * Engine responsibilities:
 *   - Parse the `classification_manifest` block out of CLAUDE.md.
 *   - Resolve a document's zone + governance via the L1 → L2 → L3 cascade.
 *   - Flag Zone Challenges when frontmatter metadata contradicts the
 *     folder-implied classification (§2.4) — the document is NOT blocked;
 *     it remains injectable, and the challenge surfaces to the Czar.
 *
 * Not the engine's job:
 *   - Acting on a challenge (the Czar resolves it via the Inbox).
 *   - Running the L3 content scanner (rule-based vs. model call — spec §7
 *     open item). Caller supplies pre-computed signals.
 *   - Knowing which zone is "Enterprise" or "Public" — those are org-
 *     defined zone IDs. Caller supplies the default.
 */

/** A folder pattern entry in the classification manifest (§2.3). */
interface FolderPattern {
    /** Folder prefix (e.g. "strategy/", "client/acme/"). Trailing slash required. */
    path: string;
    zone: string;
    governance: GovernanceTier;
}
/**
 * Parsed `classification_manifest` block from CLAUDE.md (§2.3).
 * `schema_version` enables forward compatibility — agents check the version
 * before applying rules.
 */
interface ClassificationManifest {
    schema_version: string;
    patterns: FolderPattern[];
}
/**
 * Content signals supplied by the caller for L3 fallback classification
 * (§2.1 Level 3). The engine does not infer these — the bridge or a
 * dedicated content scanner produces them.
 */
type ContentSignal = "pii" | "client-identifying" | "public-facing";
/** Outcome of running the cascade for a single document. */
interface ClassificationResult {
    zone: string;
    governance: GovernanceTier;
    /** Which cascade level produced the result (§2.1). */
    level: 1 | 2 | 3;
    /**
     * True when L3 fallback was used and the result needs Czar confirmation
     * (§2.1: "Fallback classification is flagged as unconfirmed").
     */
    unconfirmed: boolean;
}
/**
 * Zone Challenge record (§2.4). Emitted when frontmatter declares a zone
 * that contradicts the folder-implied zone. The document remains
 * injectable; the Czar resolves the challenge via the Inbox.
 */
interface ZoneChallenge {
    documentId: string;
    declaredZone: string;
    impliedZone: string;
    declaredGovernance?: GovernanceTier;
    impliedGovernance: GovernanceTier;
}
declare const classificationManifestSchema: z.ZodObject<{
    schema_version: z.ZodString;
    patterns: z.ZodArray<z.ZodObject<{
        path: z.ZodEffects<z.ZodString, string, string>;
        zone: z.ZodString;
        governance: z.ZodEnum<["primary", "standard"]>;
    }, "strip", z.ZodTypeAny, {
        path: string;
        zone: string;
        governance: "primary" | "standard";
    }, {
        path: string;
        zone: string;
        governance: "primary" | "standard";
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    schema_version: string;
    patterns: {
        path: string;
        zone: string;
        governance: "primary" | "standard";
    }[];
}, {
    schema_version: string;
    patterns: {
        path: string;
        zone: string;
        governance: "primary" | "standard";
    }[];
}>;
/**
 * Parse a `classification_manifest` YAML object (already extracted from
 * its host file) into a validated `ClassificationManifest`. Throws
 * `ConfigError` on schema failure.
 */
declare function parseClassificationManifest(raw: unknown): ClassificationManifest;
/**
 * Locate and extract the `classification_manifest` block from a CLAUDE.md
 * file (§2.3). Returns `null` when the block is absent — callers should
 * treat that as "use folder-default cascade only".
 *
 * Supported syntaxes:
 *   1. A fenced ```yaml … ``` block containing `classification_manifest:`
 *      as a top-level key.
 *   2. A bare `classification_manifest:` YAML block not fenced.
 */
declare function extractManifestFromClaudeMd(claudeMdContent: string): ClassificationManifest | null;
/** Input to `classifyDocument`. */
interface ClassifyInput {
    /**
     * Document path relative to the vault root (forward slashes), e.g.
     * "client/acme/discovery.md" or "strategy/q4-plan.md". The cascade
     * matches folder patterns against this path.
     */
    documentPath: string;
    frontmatter: Frontmatter;
    manifest: ClassificationManifest;
    /**
     * Pre-computed L3 content signals supplied by the caller (§2.1 L3).
     * Engine does NOT scan content itself.
     */
    contentSignals?: ContentSignal[];
    /**
     * Map content signals to zone IDs. Caller supplies based on its zone
     * registry — engine does not assume which zone is "Enterprise" or
     * "Public". Unmapped signals fall through to `defaultZone`.
     */
    signalZoneMap?: Partial<Record<ContentSignal, string>>;
    /**
     * Default zone for the no-signal / no-match case (§2.1: "No signals →
     * Enterprise zone by default"). The caller passes the org's Enterprise
     * zone ID here.
     */
    defaultZone: string;
}
/**
 * Resolve a document's zone + governance via the L1 → L2 → L3 cascade.
 *
 * Precedence (§2.1):
 *   - L2 (frontmatter metadata) overrides L1 when set.
 *   - L1 (folder path) is the primary signal.
 *   - L3 (content signals / default) is the fallback when neither set.
 *
 * A Zone Challenge raised by `detectZoneChallenge` does NOT change the
 * resolution here — metadata still wins (§2.4: doc remains injectable).
 * The challenge is a separate audit record.
 */
declare function classifyDocument(input: ClassifyInput): ClassificationResult;
/** Input to `detectZoneChallenge`. */
interface ZoneChallengeInput {
    documentId: string;
    documentPath: string;
    frontmatter: Frontmatter;
    manifest: ClassificationManifest;
}
/**
 * Emit a Zone Challenge when frontmatter declares a zone that contradicts
 * the folder-implied zone (§2.4). Returns `null` when there is no
 * contradiction (no metadata zone, or metadata zone matches folder, or no
 * folder pattern matches).
 *
 * Per spec: the document is NOT blocked. The challenge is informational
 * for the Czar to resolve via the Inbox.
 */
declare function detectZoneChallenge(input: ZoneChallengeInput): ZoneChallenge | null;

/**
 * Zod validation schemas for Context Nest documents.
 * Covers validation rules 1–17 from §13.
 */

declare const NODE_TYPES: readonly ["document", "snippet", "glossary", "persona", "prompt", "source", "tool", "reference", "skill"];
declare const STATUSES: readonly ["draft", "published"];
declare const TRANSPORTS: readonly ["mcp", "rest", "cli", "function"];
/** Governance tier enum (zone-classification-rbac-spec §1) */
declare const GOVERNANCE_TIERS: readonly ["primary", "standard"];
/** Suggestion source enum (bridge-function-spec Story 3.1, Story 1.3) */
declare const SUGGESTION_SOURCES: readonly ["out-of-band-edit", "remote-push", "manual-suggestion", "quarantine"];
/** Hash chain event taxonomy (zone-classification-rbac-spec §6, hootie-inbox-spec §8) */
declare const HASH_CHAIN_EVENT_TYPES: readonly ["primary.approved", "primary.rejected", "primary.rolled_back", "primary.force_pushed", "primary.force_push_acknowledged", "standard.owner_approved", "standard.owner_altered", "standard.owner_rolled_back", "dream.proposed", "dream.approved", "dream.rejected", "dream.blocked_cross_zone", "todo.delegated", "zone.created", "zone.deleted", "czar.appointed", "czar.removed", "czar.vacancy_declared", "permission.granted", "permission.revoked", "permission.self_granted", "zone_challenge.raised", "zone_challenge.resolved", "reclassification.approved", "reclassification.rejected", "bridge_document.created", "manifest.updated", "platform_admin.toggle_changed", "platform_admin.session_opened", "platform_admin.session_closed", "agent.zone_scope_assigned"];
/** Zone ID pattern: lowercase letter start, then alphanumeric / hyphen / underscore */
declare const ZONE_ID_PATTERN: RegExp;
/** Tag pattern: optional # prefix, then letter, then alphanumeric/underscore/hyphen (§13 rule 5) */
declare const TAG_PATTERN: RegExp;
/** Checksum pattern (§13 rule 8) */
declare const CHECKSUM_PATTERN: RegExp;
declare const frontmatterSchema: z.ZodEffects<z.ZodObject<{
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<["document", "snippet", "glossary", "persona", "prompt", "source", "tool", "reference", "skill"]>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    status: z.ZodOptional<z.ZodEnum<["draft", "published"]>>;
    version: z.ZodOptional<z.ZodNumber>;
    author: z.ZodOptional<z.ZodString>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
    derived_from: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    checksum: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    source: z.ZodOptional<z.ZodObject<{
        transport: z.ZodEnum<["mcp", "rest", "cli", "function"]>;
        server: z.ZodOptional<z.ZodString>;
        tools: z.ZodArray<z.ZodString, "many">;
        depends_on: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        cache_ttl: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        transport: "function" | "mcp" | "rest" | "cli";
        tools: string[];
        depends_on?: string[] | undefined;
        server?: string | undefined;
        cache_ttl?: number | undefined;
    }, {
        transport: "function" | "mcp" | "rest" | "cli";
        tools: string[];
        depends_on?: string[] | undefined;
        server?: string | undefined;
        cache_ttl?: number | undefined;
    }>>;
    skill: z.ZodOptional<z.ZodObject<{
        trigger: z.ZodString;
        inputs: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            type: z.ZodEnum<["string", "number", "boolean", "array", "object"]>;
            description: z.ZodOptional<z.ZodString>;
            required: z.ZodOptional<z.ZodBoolean>;
            default: z.ZodOptional<z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            required?: boolean | undefined;
            default?: unknown;
        }, {
            name: string;
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            required?: boolean | undefined;
            default?: unknown;
        }>, "many">>;
        tools_required: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        output_format: z.ZodOptional<z.ZodEnum<["markdown", "json", "text", "code"]>>;
        guard_rails: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        trigger: string;
        inputs?: {
            name: string;
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            required?: boolean | undefined;
            default?: unknown;
        }[] | undefined;
        tools_required?: string[] | undefined;
        output_format?: "markdown" | "json" | "text" | "code" | undefined;
        guard_rails?: string[] | undefined;
    }, {
        trigger: string;
        inputs?: {
            name: string;
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            required?: boolean | undefined;
            default?: unknown;
        }[] | undefined;
        tools_required?: string[] | undefined;
        output_format?: "markdown" | "json" | "text" | "code" | undefined;
        guard_rails?: string[] | undefined;
    }>>;
    zone: z.ZodOptional<z.ZodString>;
    governance: z.ZodOptional<z.ZodEnum<["primary", "standard"]>>;
}, "strip", z.ZodTypeAny, {
    title: string;
    source?: {
        transport: "function" | "mcp" | "rest" | "cli";
        tools: string[];
        depends_on?: string[] | undefined;
        server?: string | undefined;
        cache_ttl?: number | undefined;
    } | undefined;
    skill?: {
        trigger: string;
        inputs?: {
            name: string;
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            required?: boolean | undefined;
            default?: unknown;
        }[] | undefined;
        tools_required?: string[] | undefined;
        output_format?: "markdown" | "json" | "text" | "code" | undefined;
        guard_rails?: string[] | undefined;
    } | undefined;
    type?: "document" | "snippet" | "glossary" | "persona" | "prompt" | "source" | "tool" | "reference" | "skill" | undefined;
    status?: "draft" | "published" | undefined;
    description?: string | undefined;
    tags?: string[] | undefined;
    version?: number | undefined;
    author?: string | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
    derived_from?: string[] | undefined;
    checksum?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    zone?: string | undefined;
    governance?: "primary" | "standard" | undefined;
}, {
    title: string;
    source?: {
        transport: "function" | "mcp" | "rest" | "cli";
        tools: string[];
        depends_on?: string[] | undefined;
        server?: string | undefined;
        cache_ttl?: number | undefined;
    } | undefined;
    skill?: {
        trigger: string;
        inputs?: {
            name: string;
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            required?: boolean | undefined;
            default?: unknown;
        }[] | undefined;
        tools_required?: string[] | undefined;
        output_format?: "markdown" | "json" | "text" | "code" | undefined;
        guard_rails?: string[] | undefined;
    } | undefined;
    type?: "document" | "snippet" | "glossary" | "persona" | "prompt" | "source" | "tool" | "reference" | "skill" | undefined;
    status?: "draft" | "published" | undefined;
    description?: string | undefined;
    tags?: string[] | undefined;
    version?: number | undefined;
    author?: string | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
    derived_from?: string[] | undefined;
    checksum?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    zone?: string | undefined;
    governance?: "primary" | "standard" | undefined;
}>, {
    title: string;
    source?: {
        transport: "function" | "mcp" | "rest" | "cli";
        tools: string[];
        depends_on?: string[] | undefined;
        server?: string | undefined;
        cache_ttl?: number | undefined;
    } | undefined;
    skill?: {
        trigger: string;
        inputs?: {
            name: string;
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            required?: boolean | undefined;
            default?: unknown;
        }[] | undefined;
        tools_required?: string[] | undefined;
        output_format?: "markdown" | "json" | "text" | "code" | undefined;
        guard_rails?: string[] | undefined;
    } | undefined;
    type?: "document" | "snippet" | "glossary" | "persona" | "prompt" | "source" | "tool" | "reference" | "skill" | undefined;
    status?: "draft" | "published" | undefined;
    description?: string | undefined;
    tags?: string[] | undefined;
    version?: number | undefined;
    author?: string | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
    derived_from?: string[] | undefined;
    checksum?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    zone?: string | undefined;
    governance?: "primary" | "standard" | undefined;
}, {
    title: string;
    source?: {
        transport: "function" | "mcp" | "rest" | "cli";
        tools: string[];
        depends_on?: string[] | undefined;
        server?: string | undefined;
        cache_ttl?: number | undefined;
    } | undefined;
    skill?: {
        trigger: string;
        inputs?: {
            name: string;
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            required?: boolean | undefined;
            default?: unknown;
        }[] | undefined;
        tools_required?: string[] | undefined;
        output_format?: "markdown" | "json" | "text" | "code" | undefined;
        guard_rails?: string[] | undefined;
    } | undefined;
    type?: "document" | "snippet" | "glossary" | "persona" | "prompt" | "source" | "tool" | "reference" | "skill" | undefined;
    status?: "draft" | "published" | undefined;
    description?: string | undefined;
    tags?: string[] | undefined;
    version?: number | undefined;
    author?: string | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
    derived_from?: string[] | undefined;
    checksum?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    zone?: string | undefined;
    governance?: "primary" | "standard" | undefined;
}>;
declare const nestConfigSchema: z.ZodObject<{
    version: z.ZodNumber;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    defaults: z.ZodOptional<z.ZodObject<{
        status: z.ZodOptional<z.ZodEnum<["draft", "published"]>>;
    }, "strip", z.ZodTypeAny, {
        status?: "draft" | "published" | undefined;
    }, {
        status?: "draft" | "published" | undefined;
    }>>;
    folders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        description: z.ZodOptional<z.ZodString>;
        template: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        description?: string | undefined;
        template?: string | undefined;
    }, {
        description?: string | undefined;
        template?: string | undefined;
    }>>>;
    servers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        url: z.ZodString;
        transport: z.ZodEnum<["mcp", "rest", "cli", "function"]>;
        description: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        transport: "function" | "mcp" | "rest" | "cli";
        url: string;
        description?: string | undefined;
    }, {
        transport: "function" | "mcp" | "rest" | "cli";
        url: string;
        description?: string | undefined;
    }>>>;
    sync: z.ZodOptional<z.ZodObject<{
        promptowl_data_room_id: z.ZodOptional<z.ZodString>;
        auto_index: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        promptowl_data_room_id?: string | undefined;
        auto_index?: boolean | undefined;
    }, {
        promptowl_data_room_id?: string | undefined;
        auto_index?: boolean | undefined;
    }>>;
    agent_maintenance_directive: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    version: number;
    description?: string | undefined;
    defaults?: {
        status?: "draft" | "published" | undefined;
    } | undefined;
    folders?: Record<string, {
        description?: string | undefined;
        template?: string | undefined;
    }> | undefined;
    servers?: Record<string, {
        transport: "function" | "mcp" | "rest" | "cli";
        url: string;
        description?: string | undefined;
    }> | undefined;
    sync?: {
        promptowl_data_room_id?: string | undefined;
        auto_index?: boolean | undefined;
    } | undefined;
    agent_maintenance_directive?: string | undefined;
}, {
    name: string;
    version: number;
    description?: string | undefined;
    defaults?: {
        status?: "draft" | "published" | undefined;
    } | undefined;
    folders?: Record<string, {
        description?: string | undefined;
        template?: string | undefined;
    }> | undefined;
    servers?: Record<string, {
        transport: "function" | "mcp" | "rest" | "cli";
        url: string;
        description?: string | undefined;
    }> | undefined;
    sync?: {
        promptowl_data_room_id?: string | undefined;
        auto_index?: boolean | undefined;
    } | undefined;
    agent_maintenance_directive?: string | undefined;
}>;
declare const packSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    query: z.ZodOptional<z.ZodString>;
    includes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    excludes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    filters: z.ZodOptional<z.ZodObject<{
        node_types: z.ZodOptional<z.ZodArray<z.ZodEnum<["document", "snippet", "glossary", "persona", "prompt", "source", "tool", "reference", "skill"]>, "many">>;
    }, "strip", z.ZodTypeAny, {
        node_types?: ("document" | "snippet" | "glossary" | "persona" | "prompt" | "source" | "tool" | "reference" | "skill")[] | undefined;
    }, {
        node_types?: ("document" | "snippet" | "glossary" | "persona" | "prompt" | "source" | "tool" | "reference" | "skill")[] | undefined;
    }>>;
    agent_instructions: z.ZodOptional<z.ZodString>;
    audiences: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    id: string;
    label: string;
    includes?: string[] | undefined;
    description?: string | undefined;
    query?: string | undefined;
    excludes?: string[] | undefined;
    filters?: {
        node_types?: ("document" | "snippet" | "glossary" | "persona" | "prompt" | "source" | "tool" | "reference" | "skill")[] | undefined;
    } | undefined;
    agent_instructions?: string | undefined;
    audiences?: string[] | undefined;
}, {
    id: string;
    label: string;
    includes?: string[] | undefined;
    description?: string | undefined;
    query?: string | undefined;
    excludes?: string[] | undefined;
    filters?: {
        node_types?: ("document" | "snippet" | "glossary" | "persona" | "prompt" | "source" | "tool" | "reference" | "skill")[] | undefined;
    } | undefined;
    agent_instructions?: string | undefined;
    audiences?: string[] | undefined;
}>;
declare const versionEntrySchema: z.ZodObject<{
    version: z.ZodNumber;
    keyframe: z.ZodOptional<z.ZodBoolean>;
    diff: z.ZodOptional<z.ZodString>;
    edited_by: z.ZodString;
    edited_at: z.ZodString;
    published_at: z.ZodOptional<z.ZodString>;
    note: z.ZodOptional<z.ZodString>;
    content_hash: z.ZodString;
    chain_hash: z.ZodString;
}, "strip", z.ZodTypeAny, {
    version: number;
    edited_by: string;
    edited_at: string;
    content_hash: string;
    chain_hash: string;
    keyframe?: boolean | undefined;
    diff?: string | undefined;
    published_at?: string | undefined;
    note?: string | undefined;
}, {
    version: number;
    edited_by: string;
    edited_at: string;
    content_hash: string;
    chain_hash: string;
    keyframe?: boolean | undefined;
    diff?: string | undefined;
    published_at?: string | undefined;
    note?: string | undefined;
}>;
declare const documentHistorySchema: z.ZodObject<{
    keyframe_interval: z.ZodDefault<z.ZodNumber>;
    versions: z.ZodArray<z.ZodObject<{
        version: z.ZodNumber;
        keyframe: z.ZodOptional<z.ZodBoolean>;
        diff: z.ZodOptional<z.ZodString>;
        edited_by: z.ZodString;
        edited_at: z.ZodString;
        published_at: z.ZodOptional<z.ZodString>;
        note: z.ZodOptional<z.ZodString>;
        content_hash: z.ZodString;
        chain_hash: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        version: number;
        edited_by: string;
        edited_at: string;
        content_hash: string;
        chain_hash: string;
        keyframe?: boolean | undefined;
        diff?: string | undefined;
        published_at?: string | undefined;
        note?: string | undefined;
    }, {
        version: number;
        edited_by: string;
        edited_at: string;
        content_hash: string;
        chain_hash: string;
        keyframe?: boolean | undefined;
        diff?: string | undefined;
        published_at?: string | undefined;
        note?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    keyframe_interval: number;
    versions: {
        version: number;
        edited_by: string;
        edited_at: string;
        content_hash: string;
        chain_hash: string;
        keyframe?: boolean | undefined;
        diff?: string | undefined;
        published_at?: string | undefined;
        note?: string | undefined;
    }[];
}, {
    versions: {
        version: number;
        edited_by: string;
        edited_at: string;
        content_hash: string;
        chain_hash: string;
        keyframe?: boolean | undefined;
        diff?: string | undefined;
        published_at?: string | undefined;
        note?: string | undefined;
    }[];
    keyframe_interval?: number | undefined;
}>;
declare const checkpointSchema: z.ZodObject<{
    checkpoint: z.ZodNumber;
    at: z.ZodString;
    triggered_by: z.ZodString;
    document_versions: z.ZodRecord<z.ZodString, z.ZodNumber>;
    document_chain_hashes: z.ZodRecord<z.ZodString, z.ZodString>;
    checkpoint_hash: z.ZodString;
}, "strip", z.ZodTypeAny, {
    at: string;
    checkpoint: number;
    triggered_by: string;
    document_versions: Record<string, number>;
    document_chain_hashes: Record<string, string>;
    checkpoint_hash: string;
}, {
    at: string;
    checkpoint: number;
    triggered_by: string;
    document_versions: Record<string, number>;
    document_chain_hashes: Record<string, string>;
    checkpoint_hash: string;
}>;
declare const checkpointHistorySchema: z.ZodObject<{
    checkpoints: z.ZodArray<z.ZodObject<{
        checkpoint: z.ZodNumber;
        at: z.ZodString;
        triggered_by: z.ZodString;
        document_versions: z.ZodRecord<z.ZodString, z.ZodNumber>;
        document_chain_hashes: z.ZodRecord<z.ZodString, z.ZodString>;
        checkpoint_hash: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        at: string;
        checkpoint: number;
        triggered_by: string;
        document_versions: Record<string, number>;
        document_chain_hashes: Record<string, string>;
        checkpoint_hash: string;
    }, {
        at: string;
        checkpoint: number;
        triggered_by: string;
        document_versions: Record<string, number>;
        document_chain_hashes: Record<string, string>;
        checkpoint_hash: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    checkpoints: {
        at: string;
        checkpoint: number;
        triggered_by: string;
        document_versions: Record<string, number>;
        document_chain_hashes: Record<string, string>;
        checkpoint_hash: string;
    }[];
}, {
    checkpoints: {
        at: string;
        checkpoint: number;
        triggered_by: string;
        document_versions: Record<string, number>;
        document_chain_hashes: Record<string, string>;
        checkpoint_hash: string;
    }[];
}>;
/**
 * Suggestion metadata schema — persisted in `_suggestions/{doc}-...meta.yaml`
 * alongside the patch file. One per staged drift (bridge-function-spec
 * Story 3.1, hootie-inbox-spec §4.1).
 */
declare const suggestionMetaSchema: z.ZodObject<{
    suggestion_id: z.ZodString;
    document_id: z.ZodString;
    zone: z.ZodOptional<z.ZodString>;
    doc_tier: z.ZodEnum<["primary", "standard"]>;
    source: z.ZodEnum<["out-of-band-edit", "remote-push", "manual-suggestion", "quarantine"]>;
    actor: z.ZodString;
    detected_at: z.ZodString;
    target_hash: z.ZodString;
    proposed_hash: z.ZodString;
    patch_path: z.ZodString;
    note: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    source: "out-of-band-edit" | "remote-push" | "manual-suggestion" | "quarantine";
    suggestion_id: string;
    document_id: string;
    doc_tier: "primary" | "standard";
    actor: string;
    detected_at: string;
    target_hash: string;
    proposed_hash: string;
    patch_path: string;
    zone?: string | undefined;
    note?: string | undefined;
}, {
    source: "out-of-band-edit" | "remote-push" | "manual-suggestion" | "quarantine";
    suggestion_id: string;
    document_id: string;
    doc_tier: "primary" | "standard";
    actor: string;
    detected_at: string;
    target_hash: string;
    proposed_hash: string;
    patch_path: string;
    zone?: string | undefined;
    note?: string | undefined;
}>;
/**
 * Hash chain event schema — every governance action emits one of these
 * (zone-classification-rbac-spec §6, hootie-inbox-spec §8). Events are
 * immutable; the chain is append-only.
 */
declare const hashChainEventSchema: z.ZodObject<{
    event_id: z.ZodString;
    event_type: z.ZodEnum<["primary.approved", "primary.rejected", "primary.rolled_back", "primary.force_pushed", "primary.force_push_acknowledged", "standard.owner_approved", "standard.owner_altered", "standard.owner_rolled_back", "dream.proposed", "dream.approved", "dream.rejected", "dream.blocked_cross_zone", "todo.delegated", "zone.created", "zone.deleted", "czar.appointed", "czar.removed", "czar.vacancy_declared", "permission.granted", "permission.revoked", "permission.self_granted", "zone_challenge.raised", "zone_challenge.resolved", "reclassification.approved", "reclassification.rejected", "bridge_document.created", "manifest.updated", "platform_admin.toggle_changed", "platform_admin.session_opened", "platform_admin.session_closed", "agent.zone_scope_assigned"]>;
    timestamp: z.ZodString;
    actor: z.ZodString;
    zone: z.ZodOptional<z.ZodString>;
    document_id: z.ZodOptional<z.ZodString>;
    resulting_hash: z.ZodOptional<z.ZodString>;
    action_metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    signature: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    actor: string;
    event_id: string;
    event_type: "primary.approved" | "primary.rejected" | "primary.rolled_back" | "primary.force_pushed" | "primary.force_push_acknowledged" | "standard.owner_approved" | "standard.owner_altered" | "standard.owner_rolled_back" | "dream.proposed" | "dream.approved" | "dream.rejected" | "dream.blocked_cross_zone" | "todo.delegated" | "zone.created" | "zone.deleted" | "czar.appointed" | "czar.removed" | "czar.vacancy_declared" | "permission.granted" | "permission.revoked" | "permission.self_granted" | "zone_challenge.raised" | "zone_challenge.resolved" | "reclassification.approved" | "reclassification.rejected" | "bridge_document.created" | "manifest.updated" | "platform_admin.toggle_changed" | "platform_admin.session_opened" | "platform_admin.session_closed" | "agent.zone_scope_assigned";
    timestamp: string;
    zone?: string | undefined;
    document_id?: string | undefined;
    resulting_hash?: string | undefined;
    action_metadata?: Record<string, unknown> | undefined;
    signature?: string | undefined;
}, {
    actor: string;
    event_id: string;
    event_type: "primary.approved" | "primary.rejected" | "primary.rolled_back" | "primary.force_pushed" | "primary.force_push_acknowledged" | "standard.owner_approved" | "standard.owner_altered" | "standard.owner_rolled_back" | "dream.proposed" | "dream.approved" | "dream.rejected" | "dream.blocked_cross_zone" | "todo.delegated" | "zone.created" | "zone.deleted" | "czar.appointed" | "czar.removed" | "czar.vacancy_declared" | "permission.granted" | "permission.revoked" | "permission.self_granted" | "zone_challenge.raised" | "zone_challenge.resolved" | "reclassification.approved" | "reclassification.rejected" | "bridge_document.created" | "manifest.updated" | "platform_admin.toggle_changed" | "platform_admin.session_opened" | "platform_admin.session_closed" | "agent.zone_scope_assigned";
    timestamp: string;
    zone?: string | undefined;
    document_id?: string | undefined;
    resulting_hash?: string | undefined;
    action_metadata?: Record<string, unknown> | undefined;
    signature?: string | undefined;
}>;

/**
 * Document parsing and serialization.
 * Uses gray-matter for frontmatter extraction and Zod for validation.
 */

/** Normalize tags to always include the # prefix. Filters out null/undefined entries caused by YAML comment parsing. */
declare function normalizeTags(tags?: unknown[]): string[] | undefined;
/** Strip # prefix from tags (for context.yaml output per §5) */
declare function stripTagPrefix(tags: string[]): string[];
/**
 * Parse a Context Nest document from its file content.
 * Returns the parsed ContextNode with validated frontmatter.
 */
declare function parseDocument(filePath: string, content: string, id: string): ContextNode;
/**
 * Validate a document's frontmatter against the schema.
 * Returns a ValidationResult with all errors found.
 */
declare function validateDocument(node: ContextNode): ValidationResult;
/**
 * Serialize a ContextNode back to file content.
 * Roundtrip-safe: parse(serialize(node)) === node
 */
declare function serializeDocument(node: ContextNode): string;
/**
 * Compute the document body content for checksum calculation.
 * Per §1.5: SHA-256 of all content after the closing --- of frontmatter, including the leading newline.
 */
declare function getChecksumContent(rawContent: string): string;

/**
 * Configuration loading for .context/config.yaml and syntax.yml (§11).
 */

/**
 * Parse and validate .context/config.yaml content.
 */
declare function parseConfig(content: string): NestConfig;
/** Syntax token configuration from syntax.yml (§11.2) */
interface SyntaxConfig {
    tokens: {
        tag: string;
        pack_reference: string;
    };
}
/**
 * Parse syntax.yml. Returns defaults if content is empty/undefined.
 */
declare function parseSyntaxConfig(content?: string): SyntaxConfig;

/**
 * contextnest:// URI parsing, canonicalization, and serialization (§4).
 */

/**
 * Parse a contextnest:// URI into its components (§4.1).
 */
declare function parseUri(raw: string): ContextNestUri;
/**
 * Canonicalize a ContextNestUri (§4.3).
 */
declare function canonicalizeUri(uri: ContextNestUri): string;
/**
 * Serialize a ContextNestUri to its canonical string form.
 */
declare function serializeUri(uri: ContextNestUri): string;
/**
 * Extract the document path from a contextnest:// URI string.
 * Convenience function for resolving links.
 */
declare function extractPath(uriStr: string): string;

/**
 * URI resolution: resolves contextnest:// URIs to documents (§4.2).
 */

interface ResolverOptions {
    /** All documents in the vault */
    documents: ContextNode[];
    /** Checkpoint history for pinned resolution */
    checkpoints?: Checkpoint[];
    /** Function to reconstruct a specific version of a document */
    reconstructVersion?: (docId: string, version: number) => Promise<string>;
}
declare class Resolver {
    private documents;
    private tagIndex;
    private searchIndex;
    private checkpoints;
    private reconstructVersion?;
    constructor(options: ResolverOptions);
    /**
     * Resolve a parsed URI to matching documents.
     * Only returns published documents by default.
     */
    resolve(uri: ContextNestUri, options?: {
        includeDrafts?: boolean;
    }): Promise<ContextNode[]>;
    private resolveDocument;
    private resolvePinned;
    private resolveTag;
    private resolveFolder;
    private resolveSearch;
    /** Get a document by id (no filtering) */
    getDocument(id: string): ContextNode | undefined;
    /** Get all published documents */
    getPublishedDocuments(): ContextNode[];
    /** Get all documents */
    getAllDocuments(): ContextNode[];
}

/**
 * Inline syntax extraction from markdown bodies (§1.7).
 * Extracts contextnest:// links, #tags, @mentions, and task checkboxes.
 */

/** Extract all contextnest:// link targets from a markdown body */
declare function extractContextLinks(body: string): string[];
/** Extract all #tag references from a markdown body */
declare function extractTags(body: string): string[];
/** Extract all @mention references from a markdown body */
declare function extractMentions(body: string): string[];
/** Count task checkboxes in a markdown body */
declare function countTasks(body: string): {
    total: number;
    completed: number;
};
/**
 * Build a relationship edge list from all documents.
 * Extracts `reference` edges from contextnest:// links
 * and `depends_on` edges from source node frontmatter.
 */
declare function buildRelationships(documents: ContextNode[]): RelationshipEdge[];
/**
 * Build a backlinks map: for each document, which other documents reference it.
 */
declare function buildBacklinks(documents: ContextNode[]): Map<string, string[]>;
/**
 * Extract section content by anchor from a markdown body.
 * Returns the content from the matched heading to the next heading of same or higher level.
 */
declare function extractSection(body: string, anchor: string): string | null;

/**
 * Selector grammar lexer (§2).
 * Tokenizes selector strings into atoms and operators.
 */
type TokenType = "TAG" | "URI" | "PACK" | "TYPE_FILTER" | "STATUS_FILTER" | "TRANSPORT_FILTER" | "SERVER_FILTER" | "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN" | "EOF";
interface Token {
    type: TokenType;
    value: string;
    position: number;
}
declare function tokenize(input: string): Token[];

/**
 * Recursive descent parser for the selector grammar (§2).
 * Precedence (highest to lowest): () > AND (+) > NOT (-) > OR (|)
 *
 * Grammar:
 *   expr     → or_expr
 *   or_expr  → not_expr ("|" not_expr)*
 *   not_expr → and_expr ("-" and_expr)*
 *   and_expr → atom (("+" | implicit) atom)*
 *   atom     → TAG | URI | PACK | TYPE_FILTER | STATUS_FILTER |
 *              TRANSPORT_FILTER | SERVER_FILTER | "(" expr ")"
 */
type SelectorNode = {
    type: "tag";
    value: string;
} | {
    type: "uri";
    value: string;
} | {
    type: "pack";
    value: string;
} | {
    type: "typeFilter";
    value: string;
} | {
    type: "statusFilter";
    value: string;
} | {
    type: "transportFilter";
    value: string;
} | {
    type: "serverFilter";
    value: string;
} | {
    type: "and";
    left: SelectorNode;
    right: SelectorNode;
} | {
    type: "or";
    left: SelectorNode;
    right: SelectorNode;
} | {
    type: "not";
    left: SelectorNode;
    right: SelectorNode;
};
/**
 * Parse a selector string into an AST.
 */
declare function parseSelector(input: string): SelectorNode;

/**
 * Selector AST evaluator (§2).
 * Evaluates a selector AST against a set of documents.
 */

interface EvaluatorOptions {
    resolver: Resolver;
    packLoader?: (packId: string) => Pack | undefined;
}
/**
 * Evaluate a selector AST against the document set.
 */
declare function evaluate(node: SelectorNode, options: EvaluatorOptions): Promise<ContextNode[]>;

/**
 * Context Pack loading and expansion (§3).
 */

/**
 * PackLoader manages loading and resolving packs.
 */
declare class PackLoader {
    private packs;
    constructor(packs: Pack[]);
    /** Get a pack by id */
    get(id: string): Pack | undefined;
    /** List all packs */
    list(): Pack[];
    /** Check if a pack exists */
    has(id: string): boolean;
}

/**
 * Document version management (§6).
 * Keyframe + diff model with history.yaml tracking.
 */

declare class VersionManager {
    private storage;
    constructor(storage: NestStorage);
    /**
     * Create a new version of a document (§6.1).
     * Appends to history.yaml, writes keyframe if at keyframe interval.
     */
    createVersion(node: ContextNode, editedBy: string, options?: {
        note?: string;
        publishedAt?: string;
    }): Promise<VersionEntry>;
    /**
     * Reconstruct a specific version of a document (§6.1).
     * Finds nearest keyframe and applies diffs forward.
     */
    reconstructVersion(docId: string, targetVersion: number): Promise<string>;
    /**
     * Get version history for a document.
     */
    getHistory(docId: string): Promise<DocumentHistory | null>;
}

/**
 * Nest checkpoint management (§7) + checkpoint-time drift scan
 * (bridge-function-spec Story 2.1, Story 3.1).
 */

/** Latest checkpoint object, or null if history empty/missing. */
declare function getLatestCheckpoint(history: CheckpointHistory | null | undefined): Checkpoint | null;
/** Latest checkpoint number, or 0 if history empty/missing. */
declare function getLatestCheckpointNumber(history: CheckpointHistory | null | undefined): number;
/** Input to `scanCheckpointDrift`. */
interface CheckpointDriftScanInput {
    storage: NestStorage;
    /** Actor identifier recorded on every staged suggestion (e.g. "system:checkpoint"). */
    actor: string;
    /**
     * Optional classification manifest used to fill in `zone` / `governance`
     * when a drifted document's frontmatter does not declare them
     * (zone-classification-rbac-spec §2.1 cascade).
     */
    manifest?: ClassificationManifest;
    /**
     * Default zone used by the L3 fallback when neither frontmatter metadata
     * nor a folder match resolves a zone. If unset, undeclared documents are
     * skipped with reason "unresolved-zone".
     */
    defaultZone?: string;
    /** Default governance tier when none is resolved. Defaults to "standard". */
    defaultGovernance?: GovernanceTier;
}
/** One entry per document the scan looked at. */
interface DriftScanEntry {
    documentId: string;
    drifted: boolean;
    staged?: SuggestionMeta;
    skippedReason?: string;
}
/** Aggregate result of a checkpoint-time drift scan. */
interface CheckpointDriftScanResult {
    scanned: number;
    drifted: number;
    stagedCount: number;
    skippedCount: number;
    entries: DriftScanEntry[];
}
/**
 * Walk the entire vault, detect out-of-band edits, and stage each one as
 * a suggestion under `_suggestions/`. Per bridge-function-spec Story 2.1
 * and Story 3.1, this is the spec-prescribed interception point: drift
 * captured at checkpoint time, canonical document never mutated.
 *
 * Skipped cases (returned with `skippedReason`, not staged):
 *   - Document has no version history (legacy / never published) — nothing
 *     to diff against.
 *   - Document has no `frontmatter.checksum` — `detectDrift` cannot decide.
 *   - Zone unresolved and no `defaultZone` configured.
 *   - Live file unreadable (race with delete).
 *
 * The scan never throws on a per-doc problem — bad docs are added to
 * `entries` with a reason and the scan continues. This keeps a checkpoint
 * from failing wholesale because of one ill-formed file.
 */
declare function scanCheckpointDrift(input: CheckpointDriftScanInput): Promise<CheckpointDriftScanResult>;
declare class CheckpointManager {
    private storage;
    constructor(storage: NestStorage);
    /**
     * Run the drift scan against this manager's storage. Returns the scan
     * report without creating a checkpoint — caller decides whether to
     * proceed (e.g. abort on drifted entries, surface to Inbox, etc.).
     */
    scanForDrift(input: Omit<CheckpointDriftScanInput, "storage">): Promise<CheckpointDriftScanResult>;
    /**
     * Create a new checkpoint (§7.1).
     * Called each time a document is published.
     */
    createCheckpoint(triggeredBy: string, publishedDocuments: ContextNode[], documentHistories: Map<string, DocumentHistory>): Promise<Checkpoint>;
    /**
     * Load checkpoint history.
     */
    loadCheckpointHistory(): Promise<CheckpointHistory | null>;
    /**
     * Rebuild checkpoint history from per-document history.yaml files (§7.3).
     */
    rebuildCheckpointHistory(): Promise<CheckpointHistory>;
}

/**
 * Background hygienist scanner — bridge-function-spec Story 4.2,
 * zone-classification-rbac-spec §3.5.
 *
 * Continuous, non-locking vault traversal that detects out-of-band edits
 * and routes each to the suggestion pipeline. Differs from the checkpoint
 * scanner (step 8) in two ways:
 *
 *   1. **RBAC-scoped.** The scanner runs as a specific actor and never
 *      reads content from a zone that actor cannot ingest
 *      (zone-classification-rbac-spec §4.1, Story 4.2 negative test,
 *      Story 6.2). Cross-zone overlap detection is impossible by design.
 *
 *   2. **Idempotent by default.** A drift already represented by a pending
 *      suggestion (matching `proposed_hash`) is not re-staged on subsequent
 *      ticks — the Czar Inbox does not grow unbounded for the same edit.
 *      Caller can set `skipDocsWithPendingSuggestions: false` to force.
 *
 * Engine guarantees preserved:
 *   - Canonical live file untouched.
 *   - Hash chain head untouched.
 *   - No locks acquired on read/write; if a write races with a scan tick,
 *     the next tick sees the new state (Story 4.2: non-locking traversal).
 */

interface HygienistInput {
    storage: NestStorage;
    rbac: RbacHook;
    /**
     * Actor identity the scanner runs as. The scanner inherits this actor's
     * ingest permissions (zone-classification-rbac-spec §4.1). For
     * system-scheduled scans, supply a dedicated service identity that the
     * bridge has explicitly authorized for the relevant zones.
     */
    actor: string;
    /** Manifest used to resolve zone/tier when frontmatter lacks them. */
    manifest?: ClassificationManifest;
    /** Default zone for the L3 fallback (see §2.1). */
    defaultZone?: string;
    /** Default governance tier when none is resolved. Defaults to "standard". */
    defaultGovernance?: GovernanceTier;
    /**
     * When true (default), skip a drifted doc if a pending suggestion already
     * exists with the same `proposed_hash`. Set false to force re-stage.
     */
    skipDocsWithPendingSuggestions?: boolean;
}
interface HygienistEntry {
    documentId: string;
    drifted: boolean;
    staged?: SuggestionMeta;
    skippedReason?: string;
}
interface HygienistResult {
    scanned: number;
    drifted: number;
    stagedCount: number;
    skippedCount: number;
    /** Subset of skippedCount: docs invisible to this actor under RBAC. */
    permissionFiltered: number;
    entries: HygienistEntry[];
}
/**
 * Run one pass of the background scanner. Returns a structured report;
 * never throws on per-doc failures.
 *
 * Intended to be called on a schedule by the bridge / desktop app. The
 * engine itself does NOT schedule anything — Story 4.2 frames triggers as
 * a bridge concern (scheduled vs. on-demand).
 */
declare function runHygienistScan(input: HygienistInput): Promise<HygienistResult>;

/**
 * Document publish orchestration.
 * Ties together versioning, integrity, checkpoints, and index regeneration.
 */

interface PublishOptions {
    editedBy: string;
    note?: string;
}
interface PublishResult {
    node: ContextNode;
    versionEntry: VersionEntry;
    checkpointNumber: number;
}
/**
 * Publish a document: bump version, compute checksum, create version entry,
 * create checkpoint, and regenerate context.yaml.
 */
declare function publishDocument(storage: NestStorage, docId: string, options: PublishOptions): Promise<PublishResult>;

/**
 * Source node dependency graph and topological sort (§1.9.4).
 */

/**
 * Build a dependency adjacency list from source nodes' depends_on fields.
 */
declare function buildDependencyGraph(sourceNodes: ContextNode[]): Map<string, string[]>;
/**
 * Topologically sort source nodes by their depends_on ordering.
 * Returns node IDs in hydration order (dependencies first).
 * Throws CircularDependencyError if cycles are detected.
 */
declare function topologicalSortSources(sourceNodes: ContextNode[]): string[];
/**
 * Detect cycles in the dependency graph.
 * Returns the first cycle found as an array of node IDs, or null if acyclic.
 */
declare function detectCycles(sourceNodes: ContextNode[]): string[] | null;

/**
 * context.yaml generation (§5).
 */

/**
 * Generate context.yaml from the current vault state.
 */
declare function generateContextYaml(publishedDocuments: ContextNode[], config: NestConfig | null, latestCheckpoint: Checkpoint | null, options?: {
    namespace?: string;
    federation?: "none" | "federated" | "scoped";
}): ContextYaml;

/**
 * INDEX.md generation (§10).
 * Auto-generated folder summaries.
 */

/**
 * Generate an INDEX.md for a folder.
 */
declare function generateIndexMd(folderPath: string, folderTitle: string, documents: ContextNode[], subfolders?: Array<{
    path: string;
    description?: string;
}>): string;

/**
 * Audit trace logging (§9.2, §9.3).
 */

declare class TraceLogger {
    private traces;
    private maxTraces;
    constructor(maxTraces?: number);
    /** Evict oldest entries when buffer is full */
    private evictIfNeeded;
    /** Log a document access event (§9.2) */
    logAccess(params: {
        documentRef: string;
        documentVersion: number;
        checkpoint: number;
        author?: string;
        editedAt?: string;
    }): AccessTrace;
    /** Log a source hydration event (§9.3) */
    logSourceHydration(params: {
        sourceRef: string;
        sourceVersion: number;
        checkpoint: number;
        toolsCalled: string[];
        server?: string;
        resultHash?: string;
        resultSize?: number;
        cacheHit: boolean;
        durationMs?: number;
        error?: string;
    }): SourceHydrationTrace;
    /** Get all trace entries */
    getTraces(): TraceEntry[];
    /** Clear all traces */
    clear(): void;
}

/**
 * Context injection orchestration (§9.1).
 * Resolves selectors, orders source nodes topologically,
 * and returns documents with trace entries.
 */

interface InjectorOptions {
    resolver: Resolver;
    packLoader: PackLoader;
    currentCheckpoint: number;
}
declare class ContextInjector {
    private resolver;
    private packLoader;
    private traceLogger;
    private currentCheckpoint;
    constructor(options: InjectorOptions);
    /**
     * Inject context for a selector query.
     * Returns resolved documents with source nodes ordered topologically.
     */
    inject(selector: string): Promise<ResolvedResult>;
    /** Get the trace logger for external hydration trace logging */
    getTraceLogger(): TraceLogger;
}

/**
 * Graph traversal with hop-based depth control.
 * Uses context.yaml's pre-built graph to traverse from seed nodes
 * without loading document bodies.
 */

/**
 * BFS graph traverser with priority-weighted edge costs.
 *
 * Edge cost rules:
 * - `depends_on` edges: free (cost 0, always traversed)
 * - Edges TO a hub node: free (cost 0)
 * - Edges with explicit `priority: 0`: free
 * - `reference` edges: cost 1 hop (or explicit priority value)
 */
declare class GraphTraverser {
    /** Forward adjacency: nodeId → outbound edges */
    private forward;
    /** Reverse adjacency: nodeId → inbound edges */
    private reverse;
    /** Set of hub node IDs (edges TO these are free) */
    private hubIds;
    /** All known node IDs from context.yaml */
    private allNodeIds;
    constructor(documents: ContextYamlDocument[], relationships: RelationshipEdge[], hubs: HubEntry[]);
    /**
     * Traverse the graph from seed nodes using BFS with hop-cost accounting.
     * Supports adaptive expansion: if fewer than minResults nodes are reached,
     * retries with +1 hops up to maxAdaptiveHops.
     */
    traverse(seedIds: Set<string>, options: TraversalOptions): TraversalResult;
    private bfs;
    /**
     * Compute the hop cost for traversing an edge.
     * - depends_on: always free (cost 0)
     * - Edges TO a hub node: free (cost 0)
     * - Explicit priority 0: free
     * - reference edges: cost 1 (or explicit priority)
     */
    private edgeCost;
}

/**
 * Graph-aware query engine.
 *
 * Uses context.yaml as a lightweight graph index to evaluate selectors
 * against metadata (no bodies), then traverses edges for N hops, and
 * only loads document bodies for the nodes actually reached.
 *
 * Falls back to full-load mode when context.yaml is missing or --full is set.
 */

interface GraphQueryOptions {
    /** Number of hops from seed nodes (default: 2) */
    hops?: number;
    /** Force full-load mode (default: false) */
    full?: boolean;
    /** Include draft documents (default: false) */
    includeDrafts?: boolean;
}
declare class GraphQueryEngine {
    private storage;
    constructor(storage: NestStorage);
    /**
     * Query the vault using graph traversal.
     *
     * 1. Load context.yaml (lightweight graph index)
     * 2. Evaluate selector against metadata-only docs → seed IDs
     * 3. Traverse edges from seeds for N hops → expanded node set
     * 4. Batch-load bodies only for reached nodes
     */
    query(selector: string, options?: GraphQueryOptions): Promise<GraphQueryResult>;
    private graphQuery;
    /**
     * Auto-generate context.yaml when it's missing.
     * This makes upgrades seamless — first query triggers indexing.
     */
    private autoIndex;
    /** Fallback: full-load mode (existing behavior) */
    private fullQuery;
}

/**
 * Lightweight selector evaluator that operates on ContextYamlDocument[]
 * from context.yaml, without requiring document bodies to be loaded.
 *
 * Supports the same selector grammar as the full evaluator, but resolves
 * against the pre-built index rather than in-memory ContextNode[].
 */

interface IndexEvaluatorOptions {
    packLoader?: (packId: string) => Pack | undefined;
}
/**
 * Evaluate a selector AST against context.yaml document entries.
 * Returns a set of matching document IDs without loading any file bodies.
 */
declare function evaluateFromIndex(node: SelectorNode, documents: ContextYamlDocument[], options?: IndexEvaluatorOptions): Promise<Set<string>>;

/**
 * Auto-generate agent config files (CLAUDE.md, GEMINI.md, .cursorrules, etc.)
 * so AI tools auto-discover the vault without plugins.
 *
 * Uses delimited sections so user-authored content is preserved.
 * On each `ctx index`, only the section between BEGIN/END markers is updated.
 * If the file has no markers yet, the section is appended.
 */

interface AgentConfigInput {
    config: NestConfig | null;
    contextYaml: ContextYaml;
    packs: Pack[];
    hasMcpServer: boolean;
}
/**
 * All supported agent config targets.
 */
interface AgentConfigFile {
    /** Relative path from vault root */
    path: string;
    /** Content to merge into the file (between markers) */
    content: string;
}
/**
 * Generate all agent config files for the vault.
 */
declare function generateAgentConfigs(input: AgentConfigInput): AgentConfigFile[];
/**
 * Merge auto-generated section into an existing file's content.
 * If the file already has BEGIN/END markers, replaces that section.
 * If not, appends the section at the end.
 * Returns the merged content.
 */
declare function mergeAgentConfig(existingContent: string | null, newSection: string): string;

/**
 * Hash chain event log — persistent audit trail
 * (zone-classification-rbac-spec §6, hootie-inbox-spec §8).
 *
 * Every governance action (approve, reject, rollback, czar-direct-edit,
 * force-push, permission-grant, dream-proposal, etc.) emits a
 * `HashChainEvent`. This class persists those events to
 * `.versions/chain_events.yaml` so compliance teams can reconstruct the
 * complete governance history of any document or zone from the log alone
 * (zone-classification-rbac-spec §6: "Events are immutable").
 *
 * Engine contract:
 *   - Append-only. No update / delete.
 *   - Each entry is schema-validated before persistence; malformed
 *     payloads are rejected with a Zod error so we never write bad audit
 *     records.
 *   - The log is filesystem-only. Streaming / WebSocket delivery for the
 *     Inbox (Hootie §10 open item) is bridge-layer work.
 */

declare class ChainEventLog {
    private readonly storage;
    constructor(storage: NestStorage);
    /**
     * Append a single event. Schema-validated before write — throws on
     * malformed payloads to prevent audit record poisoning.
     */
    append(event: HashChainEvent): Promise<void>;
    /**
     * Append a batch in order (linked transactional batch —
     * zone-classification-rbac-spec §3.5, Story 4.3). All events are
     * validated up-front; partial writes are not possible because we read
     * the existing log once and write the full result back.
     */
    appendBatch(events: HashChainEvent[]): Promise<void>;
    /** Read every event, validated. Malformed historical entries are dropped silently. */
    readAll(): Promise<HashChainEvent[]>;
    /** Filter events touching a specific document. */
    readByDocument(documentId: string): Promise<HashChainEvent[]>;
    /** Filter events scoped to a specific zone. */
    readByZone(zoneId: string): Promise<HashChainEvent[]>;
    /** Filter events of one or more types. */
    readByType(types: HashChainEvent["event_type"][]): Promise<HashChainEvent[]>;
}

export { type AccessTrace, type AgentConfigFile, type AgentConfigInput, type ApprovalResult, type ApproveSuggestionInput, CHECKSUM_PATTERN, ChainBreakError, ChainEventLog, type Checkpoint, type CheckpointDriftScanInput, type CheckpointDriftScanResult, type CheckpointHistory, CheckpointManager, CircularDependencyError, type ClassificationManifest, type ClassificationResult, type ClassifyInput, ConfigError, type ContentSignal, ContextInjector, ContextNestError, type ContextNestUri, type ContextNode, type ContextYaml, type ContextYamlDocument, type CzarDirectEditInput, type CzarDirectEditResult, type DocumentHistory, DocumentNotFoundError, type DriftReport, type DriftScanEntry, type EdgeType, type EvaluatorOptions, type ExternalServer, type FederationMode, FederationNotSupportedError, type FolderPattern, type Frontmatter, FsStorageProvider, GOVERNANCE_TIERS, type GovernanceTier, GraphQueryEngine, type GraphQueryOptions, type GraphQueryResult, GraphTraverser, HASH_CHAIN_EVENT_TYPES, type HashChainEvent, type HashChainEventType, type HubEntry, type HygienistEntry, type HygienistInput, type HygienistResult, type IndexEvaluatorOptions, type InjectorOptions, IntegrityError, InvalidUriError, type LayoutMode, NODE_TYPES, type NestConfig, NestStorage, type NodeType, type Pack, PackLoader, type PendingChange, type PublishOptions, type PublishResult, QuarantineError, type RbacHook, type ReadDocumentOptions, type RejectSuggestionInput, type RejectionResult, type RelationshipEdge, type RemoteDeltaInput, type RemoteDeltaVerification, type ResolvedResult, Resolver, type ResolverOptions, type RollbackInput, type RollbackResult, STATUSES, SUGGESTION_SOURCES, type SelectorNode, type SkillInput, type SkillMeta, type SourceHydrationTrace, type SourceMeta, type StageSuggestionInput, type StageSuggestionResult, type Status, type StorageProvider, type StorageProviderConfig, type SuggestionMeta, type SuggestionSource, type SyntaxConfig, TAG_PATTERN, TRANSPORTS, type Token, type TokenType, type TraceEntry, TraceLogger, type Transport, type TraversalOptions, type TraversalResult, UNSTAGED_DRIFT_SENTINEL, UnauthorizedActionError, type ValidationError, ValidationFailedError, type ValidationResult, type VerificationReport, type VersionEntry, VersionManager, ZONE_ID_PATTERN, type ZoneChallenge, ZoneChallengeError, type ZoneChallengeInput, approveSuggestion, buildBacklinks, buildDependencyGraph, buildRelationships, canonicalJson, canonicalizeUri, checkpointHistorySchema, checkpointSchema, classificationManifestSchema, classifyDocument, computeChainHash, computeCheckpointHash, computeContentHash, countTasks, createStorageProvider, czarDirectEdit, denyAllRbac, detectCycles, detectDrift, detectZoneChallenge, documentHistorySchema, evaluate, evaluateFromIndex, extractContextLinks, extractManifestFromClaudeMd, extractMentions, extractPath, extractSection, extractTags, filterIngestibleZones, frontmatterSchema, generateAgentConfigs, generateContextYaml, generateIndexMd, getChecksumContent, getLatestCheckpoint, getLatestCheckpointNumber, hashChainEventSchema, listSuggestions, mergeAgentConfig, nestConfigSchema, normalizeForHash, normalizeTags, packSchema, parseClassificationManifest, parseConfig, parseDocument, parseSelector, parseSyntaxConfig, parseUri, publishDocument, quarantineSuggestion, readSuggestion, rejectSuggestion, requireCzar, requireDocOwner, requireIngest, rollbackDocument, runHygienistScan, scanCheckpointDrift, serializeDocument, serializeUri, sha256, stageSuggestion, stripTagPrefix, suggestionMetaSchema, tokenize, topologicalSortSources, validateDocument, verifyCheckpointChain, verifyDocumentChain, verifyRemoteDelta, versionEntrySchema };
