import {
  parseSelector,
  tokenize
} from "./chunk-ETTJRGPY.js";

// src/errors.ts
var ContextNestError = class extends Error {
  constructor(message, code, specSection) {
    super(message);
    this.code = code;
    this.specSection = specSection;
    this.name = "ContextNestError";
  }
  code;
  specSection;
};
var ValidationFailedError = class extends ContextNestError {
  constructor(message, rule, field) {
    super(message, "VALIDATION_FAILED", `\xA713 rule ${rule}`);
    this.rule = rule;
    this.field = field;
    this.name = "ValidationFailedError";
  }
  rule;
  field;
};
var DocumentNotFoundError = class extends ContextNestError {
  constructor(documentId) {
    super(`Document not found: ${documentId}`, "DOCUMENT_NOT_FOUND");
    this.documentId = documentId;
    this.name = "DocumentNotFoundError";
  }
  documentId;
};
var InvalidUriError = class extends ContextNestError {
  constructor(uri, reason) {
    super(`Invalid contextnest:// URI "${uri}": ${reason}`, "INVALID_URI", "\xA74");
    this.uri = uri;
    this.name = "InvalidUriError";
  }
  uri;
};
var CircularDependencyError = class extends ContextNestError {
  constructor(cycle) {
    super(
      `Circular dependency detected: ${cycle.join(" \u2192 ")}`,
      "CIRCULAR_DEPENDENCY",
      "\xA71.9.4"
    );
    this.cycle = cycle;
    this.name = "CircularDependencyError";
  }
  cycle;
};
var IntegrityError = class extends ContextNestError {
  constructor(message, mismatchType) {
    super(message, "INTEGRITY_ERROR", "\xA78");
    this.mismatchType = mismatchType;
    this.name = "IntegrityError";
  }
  mismatchType;
};
var FederationNotSupportedError = class extends ContextNestError {
  constructor(mode) {
    super(
      `Federation mode "${mode}" is not yet implemented`,
      "FEDERATION_NOT_SUPPORTED",
      "\xA74.0"
    );
    this.mode = mode;
    this.name = "FederationNotSupportedError";
  }
  mode;
};
var ConfigError = class extends ContextNestError {
  constructor(message) {
    super(message, "CONFIG_ERROR", "\xA711");
    this.name = "ConfigError";
  }
};
var ZoneChallengeError = class extends ContextNestError {
  constructor(documentId, declaredZone, impliedZone) {
    super(
      `Zone challenge for "${documentId}": declared "${declaredZone}" vs folder-implied "${impliedZone}"`,
      "ZONE_CHALLENGE",
      "\xA72.4"
    );
    this.documentId = documentId;
    this.declaredZone = declaredZone;
    this.impliedZone = impliedZone;
    this.name = "ZoneChallengeError";
  }
  documentId;
  declaredZone;
  impliedZone;
};
var QuarantineError = class extends ContextNestError {
  constructor(documentId, reason) {
    super(
      `Document "${documentId}" quarantined: ${reason}`,
      "QUARANTINE",
      "Story 1.3"
    );
    this.documentId = documentId;
    this.reason = reason;
    this.name = "QuarantineError";
  }
  documentId;
  reason;
};
var UnauthorizedActionError = class extends ContextNestError {
  constructor(actor, action, zone) {
    super(
      `Actor "${actor}" not authorized for action "${action}"${zone ? ` in zone "${zone}"` : ""}`,
      "UNAUTHORIZED_ACTION",
      "\xA74"
    );
    this.actor = actor;
    this.action = action;
    this.zone = zone;
    this.name = "UnauthorizedActionError";
  }
  actor;
  action;
  zone;
};
var ChainBreakError = class extends ContextNestError {
  constructor(documentId, expectedPrevHash, actualPrevHash) {
    super(
      `Chain break for "${documentId}": expected prev_chain_hash "${expectedPrevHash}", got "${actualPrevHash}"`,
      "CHAIN_BREAK",
      "\xA7367"
    );
    this.documentId = documentId;
    this.expectedPrevHash = expectedPrevHash;
    this.actualPrevHash = actualPrevHash;
    this.name = "ChainBreakError";
  }
  documentId;
  expectedPrevHash;
  actualPrevHash;
};

// src/rbac.ts
var denyAllRbac = {
  isCzar: () => false,
  canIngest: () => false,
  isDocOwner: () => false
};
async function requireCzar(hook, actor, zoneId, action) {
  const ok = await hook.isCzar(actor, zoneId);
  if (!ok) {
    throw new UnauthorizedActionError(actor, action, zoneId);
  }
}
async function requireIngest(hook, actor, zoneId, action) {
  const ok = await hook.canIngest(actor, zoneId);
  if (!ok) {
    throw new UnauthorizedActionError(actor, action, zoneId);
  }
}
async function requireDocOwner(hook, actor, documentId, action) {
  const ok = await hook.isDocOwner(actor, documentId);
  if (!ok) {
    throw new UnauthorizedActionError(actor, action);
  }
}
async function filterIngestibleZones(hook, actor, zoneIds) {
  const checks = await Promise.all(
    zoneIds.map(async (zoneId) => ({
      zoneId,
      allowed: await hook.canIngest(actor, zoneId)
    }))
  );
  return checks.filter((c) => c.allowed).map((c) => c.zoneId);
}

// src/suggestions.ts
import { createPatch } from "diff";

// src/integrity.ts
import { createHash } from "crypto";

// src/parser.ts
import matter from "gray-matter";

// src/schemas.ts
import { z } from "zod";
var NODE_TYPES = [
  "document",
  "snippet",
  "glossary",
  "persona",
  "prompt",
  "source",
  "tool",
  "reference",
  "skill"
];
var STATUSES = ["draft", "published"];
var TRANSPORTS = ["mcp", "rest", "cli", "function"];
var GOVERNANCE_TIERS = ["primary", "standard"];
var SUGGESTION_SOURCES = [
  "out-of-band-edit",
  "remote-push",
  "manual-suggestion",
  "quarantine"
];
var HASH_CHAIN_EVENT_TYPES = [
  "primary.approved",
  "primary.rejected",
  "primary.rolled_back",
  "primary.force_pushed",
  "primary.force_push_acknowledged",
  "standard.owner_approved",
  "standard.owner_altered",
  "standard.owner_rolled_back",
  "dream.proposed",
  "dream.approved",
  "dream.rejected",
  "dream.blocked_cross_zone",
  "todo.delegated",
  "zone.created",
  "zone.deleted",
  "czar.appointed",
  "czar.removed",
  "czar.vacancy_declared",
  "permission.granted",
  "permission.revoked",
  "permission.self_granted",
  "zone_challenge.raised",
  "zone_challenge.resolved",
  "reclassification.approved",
  "reclassification.rejected",
  "bridge_document.created",
  "manifest.updated",
  "platform_admin.toggle_changed",
  "platform_admin.session_opened",
  "platform_admin.session_closed",
  "agent.zone_scope_assigned"
];
var ZONE_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
var TAG_PATTERN = /^#?[a-zA-Z][a-zA-Z0-9_-]*$/;
var CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/;
var CONTEXT_NEST_URI_PATTERN = /^contextnest:\/\//;
var tagSchema = z.string().regex(TAG_PATTERN, "Tag must match pattern: ^#?[a-zA-Z][a-zA-Z0-9_-]*$");
var skillInputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "array", "object"]),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional()
});
var skillMetaSchema = z.object({
  trigger: z.string().min(1),
  inputs: z.array(skillInputSchema).optional(),
  tools_required: z.array(z.string()).optional(),
  output_format: z.enum(["markdown", "json", "text", "code"]).optional(),
  guard_rails: z.array(z.string()).optional()
});
var sourceMetaSchema = z.object({
  transport: z.enum(TRANSPORTS),
  // Rule 10
  server: z.string().optional(),
  // Rule 12
  tools: z.array(z.string()).min(1),
  // Rule 11
  depends_on: z.array(
    z.string().regex(CONTEXT_NEST_URI_PATTERN, "depends_on entries must be valid contextnest:// URIs")
    // Rule 13
  ).optional(),
  cache_ttl: z.number().int().positive().optional()
  // Rule 16
});
var frontmatterSchema = z.object({
  title: z.string().min(1).max(200),
  // Rule 2
  description: z.string().min(1).max(500).optional(),
  type: z.enum(NODE_TYPES).optional(),
  // Rule 6
  tags: z.array(tagSchema).optional(),
  // Rule 5
  status: z.enum(STATUSES).optional(),
  // Rule 7
  version: z.number().int().min(1).optional(),
  author: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  derived_from: z.array(z.string()).optional(),
  checksum: z.string().regex(CHECKSUM_PATTERN, "Checksum must match sha256:<64 hex chars>").optional(),
  // Rule 8
  metadata: z.record(z.unknown()).optional(),
  source: sourceMetaSchema.optional(),
  skill: skillMetaSchema.optional(),
  zone: z.string().regex(ZONE_ID_PATTERN, "Zone ID must match ^[a-z][a-z0-9_-]*$").optional(),
  governance: z.enum(GOVERNANCE_TIERS).optional()
}).superRefine((data, ctx) => {
  if (data.type === "source" && !data.source) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Source block is required when type is 'source' (\xA713 rule 9)",
      path: ["source"]
    });
  }
  if (data.type && data.type !== "source" && data.source) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Source block must not be present when type is not 'source' (\xA713 rule 17)",
      path: ["source"]
    });
  }
  if (data.type === "skill" && !data.skill) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Skill block is required when type is 'skill' (\xA71.10)",
      path: ["skill"]
    });
  }
  if (data.type && data.type !== "skill" && data.skill) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Skill block must not be present when type is not 'skill'",
      path: ["skill"]
    });
  }
});
var nestConfigSchema = z.object({
  version: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
  defaults: z.object({
    status: z.enum(STATUSES).optional()
  }).optional(),
  folders: z.record(
    z.object({
      description: z.string().optional(),
      template: z.string().optional()
    })
  ).optional(),
  servers: z.record(
    z.object({
      url: z.string(),
      transport: z.enum(TRANSPORTS),
      description: z.string().optional()
    })
  ).optional(),
  sync: z.object({
    promptowl_data_room_id: z.string().optional(),
    auto_index: z.boolean().optional()
  }).optional(),
  agent_maintenance_directive: z.string().optional()
});
var packSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  query: z.string().optional(),
  includes: z.array(z.string()).optional(),
  excludes: z.array(z.string()).optional(),
  filters: z.object({
    node_types: z.array(z.enum(NODE_TYPES)).optional()
  }).optional(),
  agent_instructions: z.string().optional(),
  audiences: z.array(z.string()).optional()
});
var versionEntrySchema = z.object({
  version: z.number().int().min(1),
  keyframe: z.boolean().optional(),
  diff: z.string().optional(),
  edited_by: z.string(),
  edited_at: z.string(),
  published_at: z.string().optional(),
  note: z.string().optional(),
  content_hash: z.string().regex(CHECKSUM_PATTERN),
  chain_hash: z.string().regex(CHECKSUM_PATTERN)
});
var documentHistorySchema = z.object({
  keyframe_interval: z.number().int().min(1).default(10),
  versions: z.array(versionEntrySchema)
});
var checkpointSchema = z.object({
  checkpoint: z.number().int().min(1),
  at: z.string(),
  triggered_by: z.string(),
  document_versions: z.record(z.number().int()),
  document_chain_hashes: z.record(z.string()),
  checkpoint_hash: z.string().regex(CHECKSUM_PATTERN)
});
var checkpointHistorySchema = z.object({
  checkpoints: z.array(checkpointSchema)
});
var suggestionMetaSchema = z.object({
  suggestion_id: z.string().min(1),
  document_id: z.string().min(1),
  zone: z.string().regex(ZONE_ID_PATTERN, "Zone ID must match ^[a-z][a-z0-9_-]*$").optional(),
  doc_tier: z.enum(GOVERNANCE_TIERS),
  source: z.enum(SUGGESTION_SOURCES),
  actor: z.string().min(1),
  detected_at: z.string().min(1),
  target_hash: z.string().regex(CHECKSUM_PATTERN),
  proposed_hash: z.string().regex(CHECKSUM_PATTERN),
  patch_path: z.string().min(1),
  note: z.string().optional()
});
var hashChainEventSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.enum(HASH_CHAIN_EVENT_TYPES),
  timestamp: z.string().min(1),
  actor: z.string().min(1),
  zone: z.string().regex(ZONE_ID_PATTERN, "Zone ID must match ^[a-z][a-z0-9_-]*$").optional(),
  document_id: z.string().optional(),
  resulting_hash: z.string().regex(CHECKSUM_PATTERN).optional(),
  action_metadata: z.record(z.unknown()).optional(),
  signature: z.string().optional()
});

// src/parser.ts
function normalizeTags(tags) {
  if (!tags) return void 0;
  const valid = tags.filter((tag) => typeof tag === "string" && tag.length > 0);
  if (valid.length === 0) return void 0;
  return valid.map((tag) => tag.startsWith("#") ? tag : `#${tag}`);
}
function normalizeDateField(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return void 0;
}
function stripTagPrefix(tags) {
  return tags.filter((tag) => typeof tag === "string").map((tag) => tag.startsWith("#") ? tag.slice(1) : tag);
}
function isPublished(node) {
  return node.frontmatter.status === "published";
}
function parseDocument(filePath, content, id) {
  const parsed = matter(content);
  if (parsed.data.tags) {
    parsed.data.tags = normalizeTags(parsed.data.tags);
  }
  if (parsed.data.updated_at !== void 0) {
    parsed.data.updated_at = normalizeDateField(parsed.data.updated_at);
  }
  if (parsed.data.created_at !== void 0) {
    parsed.data.created_at = normalizeDateField(parsed.data.created_at);
  }
  const frontmatter = parsed.data;
  return {
    id,
    filePath,
    frontmatter,
    body: parsed.content,
    rawContent: content
  };
}
function validateDocument(node) {
  const errors = [];
  const result = frontmatterSchema.safeParse(node.frontmatter);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path.join(".");
      let rule = 0;
      if (field === "title") rule = 2;
      else if (field.startsWith("tags")) rule = 5;
      else if (field === "type") rule = 6;
      else if (field === "status") rule = 7;
      else if (field === "checksum") rule = 8;
      else if (field === "source" && issue.message.includes("required")) rule = 9;
      else if (field === "source.transport") rule = 10;
      else if (field === "source.tools") rule = 11;
      else if (field === "source.server") rule = 12;
      else if (field.startsWith("source.depends_on")) rule = 13;
      else if (field === "source.cache_ttl") rule = 16;
      else if (field === "source" && issue.message.includes("must not")) rule = 17;
      errors.push({
        rule,
        path: node.id,
        message: issue.message,
        field: field || void 0
      });
    }
  }
  const linkPattern = /\]\(contextnest:\/\/([^)]*)\)/g;
  let match;
  while ((match = linkPattern.exec(node.body)) !== null) {
    const uri = match[1];
    if (!uri || uri.includes("//")) {
      errors.push({
        rule: 4,
        path: node.id,
        message: `Invalid contextnest:// URI in link: contextnest://${uri}`,
        field: "body"
      });
    }
  }
  return {
    valid: errors.length === 0,
    errors
  };
}
function serializeDocument(node) {
  return matter.stringify(node.body, node.frontmatter);
}
function getChecksumContent(rawContent) {
  const fmEnd = rawContent.indexOf("---", rawContent.indexOf("---") + 3);
  if (fmEnd === -1) return rawContent;
  return rawContent.slice(fmEnd + 3);
}

// src/integrity.ts
var GENESIS_SENTINEL = "contextnest:genesis:v1";
function normalizeForHash(content) {
  return content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function sha256(input) {
  const hash = createHash("sha256").update(input, "utf-8").digest("hex");
  return `sha256:${hash}`;
}
function computeContentHash(content) {
  return sha256(normalizeForHash(content));
}
function computeChainHash(previousChainHash, contentHash, version, editedBy, editedAt) {
  const prev = previousChainHash ?? GENESIS_SENTINEL;
  const input = `${prev}:${contentHash}:${version}:${editedBy}:${editedAt}`;
  return sha256(input);
}
function computeCheckpointHash(previousCheckpointHash, checkpoint, at, triggeredBy, documentVersions, documentChainHashes) {
  const prev = previousCheckpointHash ?? GENESIS_SENTINEL;
  const canonicalVersions = canonicalJson(documentVersions);
  const canonicalChainHashes = canonicalJson(documentChainHashes);
  const input = `${prev}:${checkpoint}:${at}:${triggeredBy}:${canonicalVersions}:${canonicalChainHashes}`;
  return sha256(input);
}
function canonicalJson(obj) {
  const sorted = Object.keys(obj).sort();
  const entries = sorted.map((key) => `${JSON.stringify(key)}:${JSON.stringify(obj[key])}`);
  return `{${entries.join(",")}}`;
}
function detectDrift(rawContent, storedChecksum) {
  const actualHash = computeContentHash(getChecksumContent(rawContent));
  if (!storedChecksum) {
    return { drifted: false, storedHash: null, actualHash };
  }
  return {
    drifted: actualHash !== storedChecksum,
    storedHash: storedChecksum,
    actualHash
  };
}
function verifyRemoteDelta(input) {
  const errors = [];
  const computedHash = computeContentHash(getChecksumContent(input.rawContent));
  if (computedHash !== input.declaredChecksum) {
    errors.push({
      type: "content_hash_mismatch",
      expected: input.declaredChecksum,
      actual: computedHash
    });
  }
  if (input.declaredPrevChainHash !== input.localPrevChainHash) {
    errors.push({
      type: "chain_break",
      expectedPrevChainHash: input.localPrevChainHash,
      actualPrevChainHash: input.declaredPrevChainHash
    });
  }
  return { ok: errors.length === 0, computedHash, errors };
}
function verifyDocumentChain(docId, history, readKeyframe) {
  const errors = [];
  let previousChainHash = null;
  for (const entry of history.versions) {
    let actualContent;
    if (entry.keyframe) {
      actualContent = readKeyframe(entry.version);
    } else {
      actualContent = entry.diff || "";
    }
    if (actualContent !== null) {
      const expectedContentHash = computeContentHash(actualContent);
      if (expectedContentHash !== entry.content_hash) {
        errors.push({
          type: "content_hash_mismatch",
          document: docId,
          version: entry.version,
          expected: expectedContentHash,
          actual: entry.content_hash
        });
      }
    }
    const expectedChainHash = computeChainHash(
      previousChainHash,
      entry.content_hash,
      entry.version,
      entry.edited_by,
      entry.edited_at
    );
    if (expectedChainHash !== entry.chain_hash) {
      errors.push({
        type: "chain_hash_mismatch",
        document: docId,
        version: entry.version,
        expected: expectedChainHash,
        actual: entry.chain_hash
      });
    }
    previousChainHash = entry.chain_hash;
  }
  return { valid: errors.length === 0, errors };
}
function verifyCheckpointChain(checkpoints, documentHistories) {
  const errors = [];
  let previousCheckpointHash = null;
  for (const cp of checkpoints) {
    for (const [docPath, expectedChainHash] of Object.entries(cp.document_chain_hashes)) {
      const history = documentHistories.get(docPath);
      if (!history) continue;
      const version = cp.document_versions[docPath];
      const entry = history.versions.find((v) => v.version === version);
      if (!entry) continue;
      if (entry.edited_at > cp.at) continue;
      if (entry.chain_hash !== expectedChainHash) {
        errors.push({
          type: "cross_chain_mismatch",
          document: docPath,
          version,
          checkpoint: cp.checkpoint,
          expected: expectedChainHash,
          actual: entry.chain_hash
        });
      }
    }
    const expectedHash = computeCheckpointHash(
      previousCheckpointHash,
      cp.checkpoint,
      cp.at,
      cp.triggered_by,
      cp.document_versions,
      cp.document_chain_hashes
    );
    if (expectedHash !== cp.checkpoint_hash) {
      errors.push({
        type: "checkpoint_hash_mismatch",
        checkpoint: cp.checkpoint,
        expected: expectedHash,
        actual: cp.checkpoint_hash
      });
    }
    previousCheckpointHash = cp.checkpoint_hash;
  }
  return { valid: errors.length === 0, errors };
}

// src/suggestions.ts
async function stageSuggestion(input) {
  const detectedAt = input.detectedAt ?? (/* @__PURE__ */ new Date()).toISOString();
  const targetHash = computeContentHash(getChecksumContent(input.approvedRawContent));
  const proposedHash = computeContentHash(getChecksumContent(input.proposedRawContent));
  const suggestionId = input.suggestionId ?? generateSuggestionId(detectedAt, proposedHash);
  const patch = createPatch(
    input.documentId,
    input.approvedRawContent,
    input.proposedRawContent,
    "approved",
    "proposed"
  );
  const patchPath = await input.storage.writeSuggestionPatch(
    input.documentId,
    suggestionId,
    patch
  );
  const meta = {
    suggestion_id: suggestionId,
    document_id: input.documentId,
    zone: input.zone,
    doc_tier: input.docTier,
    source: input.source,
    actor: input.actor,
    detected_at: detectedAt,
    target_hash: targetHash,
    proposed_hash: proposedHash,
    patch_path: `${suggestionId}.patch`,
    note: input.note
  };
  const validated = suggestionMetaSchema.parse(meta);
  const metaPath = await input.storage.writeSuggestionMeta(
    input.documentId,
    suggestionId,
    validated
  );
  return { meta: validated, patchPath, metaPath };
}
async function quarantineSuggestion(input) {
  return stageSuggestion({ ...input, source: "quarantine" });
}
async function listSuggestions(storage, documentId) {
  const ids = await storage.listSuggestionIds(documentId);
  const metas = [];
  for (const id of ids) {
    const raw = await storage.readSuggestionMeta(documentId, id);
    if (!raw) continue;
    const result = suggestionMetaSchema.safeParse(raw);
    if (result.success) {
      metas.push(result.data);
    }
  }
  return metas;
}
async function readSuggestion(storage, documentId, suggestionId) {
  const rawMeta = await storage.readSuggestionMeta(documentId, suggestionId);
  if (!rawMeta) return null;
  const metaResult = suggestionMetaSchema.safeParse(rawMeta);
  if (!metaResult.success) return null;
  const patch = await storage.readSuggestionPatch(documentId, suggestionId);
  if (patch === null) return null;
  return { meta: metaResult.data, patch };
}
function generateSuggestionId(detectedAt, proposedHash) {
  const shortHash = proposedHash.replace(/^sha256:/, "").slice(0, 8);
  const tsSafe = detectedAt.replace(/[:.]/g, "-");
  return `s_${tsSafe}_${shortHash}`;
}

// src/approval.ts
import { join } from "path";
import { applyPatch as applyPatch2 } from "diff";

// src/versioning.ts
import { createPatch as createPatch2, applyPatch } from "diff";
var DEFAULT_KEYFRAME_INTERVAL = 10;
var VersionManager = class {
  constructor(storage) {
    this.storage = storage;
  }
  storage;
  /**
   * Create a new version of a document (§6.1).
   * Appends to history.yaml, writes keyframe if at keyframe interval.
   */
  async createVersion(node, editedBy, options = {}) {
    const history = await this.storage.readHistory(node.id) || {
      keyframe_interval: DEFAULT_KEYFRAME_INTERVAL,
      versions: []
    };
    const currentVersion = node.frontmatter.version || 1;
    const isKeyframe = history.versions.length === 0 || currentVersion % history.keyframe_interval === 1 || currentVersion === 1;
    const fullContent = serializeDocument(node);
    const editedAt = (/* @__PURE__ */ new Date()).toISOString();
    let contentForHash;
    let diff;
    if (isKeyframe) {
      await this.storage.writeKeyframe(node.id, currentVersion, fullContent);
      contentForHash = fullContent;
    } else {
      const previousContent = await this.reconstructVersion(
        node.id,
        currentVersion - 1
      );
      diff = createPatch2(
        `v${currentVersion - 1}`,
        previousContent,
        fullContent,
        `v${currentVersion - 1}`,
        `v${currentVersion}`
      );
      contentForHash = diff;
    }
    const contentHash = computeContentHash(contentForHash);
    const previousChainHash = history.versions.length > 0 ? history.versions[history.versions.length - 1].chain_hash : null;
    const chainHash = computeChainHash(
      previousChainHash,
      contentHash,
      currentVersion,
      editedBy,
      editedAt
    );
    const entry = {
      version: currentVersion,
      ...isKeyframe ? { keyframe: true } : {},
      ...diff ? { diff } : {},
      edited_by: editedBy,
      edited_at: editedAt,
      ...options.publishedAt ? { published_at: options.publishedAt } : {},
      ...options.note ? { note: options.note } : {},
      content_hash: contentHash,
      chain_hash: chainHash
    };
    history.versions.push(entry);
    await this.storage.writeHistory(node.id, history);
    return entry;
  }
  /**
   * Reconstruct a specific version of a document (§6.1).
   * Finds nearest keyframe and applies diffs forward.
   */
  async reconstructVersion(docId, targetVersion) {
    const history = await this.storage.readHistory(docId);
    if (!history) {
      throw new Error(`No version history found for ${docId}`);
    }
    let keyframeVersion = -1;
    for (const entry of history.versions) {
      if (entry.keyframe && entry.version <= targetVersion) {
        keyframeVersion = entry.version;
      }
    }
    if (keyframeVersion === -1) {
      throw new Error(
        `No keyframe found at or before version ${targetVersion} for ${docId}`
      );
    }
    let content = await this.storage.readKeyframe(docId, keyframeVersion);
    if (content === null) {
      throw new Error(
        `Keyframe file for version ${keyframeVersion} not found for ${docId}`
      );
    }
    for (const entry of history.versions) {
      if (entry.version <= keyframeVersion) continue;
      if (entry.version > targetVersion) break;
      if (entry.keyframe) {
        const kf = await this.storage.readKeyframe(docId, entry.version);
        if (kf !== null) {
          content = kf;
          continue;
        }
      }
      if (entry.diff) {
        const result = applyPatch(content, entry.diff);
        if (typeof result === "string") {
          content = result;
        } else if (result === false) {
          throw new Error(
            `Failed to apply diff for version ${entry.version} of ${docId}`
          );
        }
      }
    }
    return content;
  }
  /**
   * Get version history for a document.
   */
  async getHistory(docId) {
    return this.storage.readHistory(docId);
  }
};

// src/approval.ts
async function approveSuggestion(input) {
  const sug = await readSuggestion(
    input.storage,
    input.documentId,
    input.suggestionId
  );
  if (!sug) {
    throw new DocumentNotFoundError(
      `suggestion:${input.documentId}/${input.suggestionId}`
    );
  }
  await gateForTier(input.rbac, sug.meta.doc_tier, {
    actor: input.actor,
    zone: input.zone,
    documentId: input.documentId,
    action: "approveSuggestion"
  });
  const approved = await loadApprovedBase(input.storage, input.documentId);
  await assertNotStale(approved.content, sug.meta.target_hash, input.suggestionId);
  const patched = applyPatch2(approved.content, sug.patch);
  if (typeof patched !== "string" || patched === "") {
    throw new IntegrityError(
      `Failed to apply suggestion "${input.suggestionId}" to current approved content`,
      "content_hash_mismatch"
    );
  }
  const { versionEntry } = await commitNewVersion({
    storage: input.storage,
    documentId: input.documentId,
    newRawContent: patched,
    actor: input.actor,
    note: input.comment
  });
  const archivedAt = await input.storage.archiveSuggestion(
    input.documentId,
    input.suggestionId,
    "approved"
  );
  const eventType = sug.meta.doc_tier === "primary" ? "primary.approved" : "standard.owner_approved";
  const chainEvent = buildChainEvent({
    eventType,
    actor: input.actor,
    zone: input.zone,
    documentId: input.documentId,
    versionEntry,
    metadata: {
      suggestion_id: input.suggestionId,
      source: sug.meta.source,
      target_hash: sug.meta.target_hash,
      proposed_hash: sug.meta.proposed_hash,
      ...input.comment ? { approval_comment: input.comment } : {}
    }
  });
  return { versionEntry, chainEvent, archivedAt };
}
async function rejectSuggestion(input) {
  if (!input.reason.trim()) {
    throw new IntegrityError(
      "Rejection requires a non-empty reason (bridge \xA75 Stage 3)",
      "content_hash_mismatch"
    );
  }
  const sug = await readSuggestion(
    input.storage,
    input.documentId,
    input.suggestionId
  );
  if (!sug) {
    throw new DocumentNotFoundError(
      `suggestion:${input.documentId}/${input.suggestionId}`
    );
  }
  await gateForTier(input.rbac, sug.meta.doc_tier, {
    actor: input.actor,
    zone: input.zone,
    documentId: input.documentId,
    action: "rejectSuggestion"
  });
  const archivedAt = await input.storage.archiveSuggestion(
    input.documentId,
    input.suggestionId,
    "rejected"
  );
  const chainEvent = {
    event_id: makeEventId(input.suggestionId, "rejected"),
    event_type: sug.meta.doc_tier === "primary" ? "primary.rejected" : (
      // Spec gives owners "approve / alter / rollback" — no explicit
      // standard rejection event. Closest fit is alter to "no change",
      // which is semantically a content-preserving owner decision.
      "standard.owner_altered"
    ),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    actor: input.actor,
    zone: input.zone,
    document_id: input.documentId,
    action_metadata: {
      suggestion_id: input.suggestionId,
      source: sug.meta.source,
      rejection_reason: input.reason
    }
  };
  return { chainEvent, archivedAt };
}
async function rollbackDocument(input) {
  await gateForTier(input.rbac, input.docTier, {
    actor: input.actor,
    zone: input.zone,
    documentId: input.documentId,
    action: "rollbackDocument"
  });
  const vm = new VersionManager(input.storage);
  const targetContent = await vm.reconstructVersion(
    input.documentId,
    input.targetVersion
  );
  const { versionEntry } = await commitNewVersion({
    storage: input.storage,
    documentId: input.documentId,
    newRawContent: targetContent,
    actor: input.actor,
    note: input.reason ? `rollback to v${input.targetVersion}: ${input.reason}` : `rollback to v${input.targetVersion}`
  });
  const eventType = input.docTier === "primary" ? "primary.rolled_back" : "standard.owner_rolled_back";
  const chainEvent = buildChainEvent({
    eventType,
    actor: input.actor,
    zone: input.zone,
    documentId: input.documentId,
    versionEntry,
    metadata: {
      target_version: input.targetVersion,
      ...input.reason ? { reason: input.reason } : {}
    }
  });
  return { versionEntry, chainEvent };
}
async function czarDirectEdit(input) {
  await requireCzar(input.rbac, input.actor, input.zone, "czarDirectEdit");
  const { versionEntry } = await commitNewVersion({
    storage: input.storage,
    documentId: input.documentId,
    newRawContent: input.newRawContent,
    actor: input.actor,
    note: input.note ?? "czar direct edit"
  });
  const chainEvent = buildChainEvent({
    eventType: "primary.approved",
    actor: input.actor,
    zone: input.zone,
    documentId: input.documentId,
    versionEntry,
    metadata: {
      direct_edit: true,
      ...input.note ? { note: input.note } : {}
    }
  });
  return { versionEntry, chainEvent };
}
async function gateForTier(rbac, tier, ctx) {
  if (tier === "primary") {
    await requireCzar(rbac, ctx.actor, ctx.zone, ctx.action);
  } else {
    await requireDocOwner(rbac, ctx.actor, ctx.documentId, ctx.action);
  }
}
async function loadApprovedBase(storage, documentId) {
  const history = await storage.readHistory(documentId);
  if (!history || history.versions.length === 0) {
    throw new DocumentNotFoundError(`approved-keyframe:${documentId}`);
  }
  const latest = history.versions[history.versions.length - 1];
  const content = await new VersionManager(storage).reconstructVersion(
    documentId,
    latest.version
  );
  return { version: latest.version, content };
}
async function assertNotStale(approvedContent, targetHashAtStaging, suggestionId) {
  const currentHead = computeContentHash(getChecksumContent(approvedContent));
  if (currentHead !== targetHashAtStaging) {
    throw new IntegrityError(
      `Suggestion "${suggestionId}" is stale: target_hash ${targetHashAtStaging} no longer matches current chain head ${currentHead}`,
      "content_hash_mismatch"
    );
  }
}
async function commitNewVersion(input) {
  const filePath = join(input.storage.root, `${input.documentId}.md`);
  const parsed = parseDocument(filePath, input.newRawContent, input.documentId);
  const newVersion = (parsed.frontmatter.version ?? 0) + 1;
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const node = {
    ...parsed,
    frontmatter: {
      ...parsed.frontmatter,
      version: newVersion,
      updated_at: updatedAt
    }
  };
  const preSerialized = serializeDocument(node);
  const newBodyHash = computeContentHash(getChecksumContent(preSerialized));
  node.frontmatter.checksum = newBodyHash;
  const serialized = serializeDocument(node);
  const finalNode = { ...node, rawContent: serialized };
  const versionEntry = await new VersionManager(input.storage).createVersion(
    finalNode,
    input.actor,
    {
      note: input.note,
      publishedAt: updatedAt
    }
  );
  await input.storage.writeDocument(input.documentId, serialized);
  return { versionEntry, serialized };
}
function buildChainEvent(args) {
  return {
    event_id: makeEventId(args.documentId, args.eventType, args.versionEntry.version),
    event_type: args.eventType,
    timestamp: args.versionEntry.edited_at,
    actor: args.actor,
    zone: args.zone,
    document_id: args.documentId,
    resulting_hash: args.versionEntry.chain_hash,
    action_metadata: args.metadata
  };
}
function makeEventId(...parts) {
  const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  return `evt_${ts}_${parts.join("_")}`;
}

// src/classification.ts
import { z as z2 } from "zod";
import yaml from "js-yaml";
var folderPatternSchema = z2.object({
  path: z2.string().min(1).refine((p) => p.endsWith("/"), "Folder pattern must end with a trailing slash"),
  zone: z2.string().regex(ZONE_ID_PATTERN, "Zone ID must match ^[a-z][a-z0-9_-]*$"),
  governance: z2.enum(GOVERNANCE_TIERS)
});
var classificationManifestSchema = z2.object({
  schema_version: z2.string().min(1),
  patterns: z2.array(folderPatternSchema)
});
function parseClassificationManifest(raw) {
  const result = classificationManifestSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.errors[0];
    throw new ConfigError(
      `Invalid classification_manifest: ${first.message} at ${first.path.join(".") || "<root>"}`
    );
  }
  return result.data;
}
function extractManifestFromClaudeMd(claudeMdContent) {
  const fencedYamlBlocks = [
    ...claudeMdContent.matchAll(/```ya?ml[ \t]*\r?\n([\s\S]*?)```/g)
  ].map((m) => m[1]);
  for (const block of fencedYamlBlocks) {
    if (!/^\s*classification_manifest\s*:/m.test(block)) continue;
    const parsed = tryYamlLoad(block);
    if (parsed && typeof parsed === "object" && "classification_manifest" in parsed) {
      return parseClassificationManifest(
        parsed.classification_manifest
      );
    }
  }
  const wholeDoc = tryYamlLoad(claudeMdContent);
  if (wholeDoc && typeof wholeDoc === "object" && "classification_manifest" in wholeDoc) {
    return parseClassificationManifest(
      wholeDoc.classification_manifest
    );
  }
  return null;
}
function tryYamlLoad(input) {
  try {
    return yaml.load(input);
  } catch {
    return null;
  }
}
function classifyDocument(input) {
  const folderMatch = matchLongestFolderPattern(
    input.documentPath,
    input.manifest.patterns
  );
  const declaredZone = input.frontmatter.zone;
  const declaredGovernance = input.frontmatter.governance;
  if (declaredZone || declaredGovernance) {
    return {
      zone: declaredZone ?? folderMatch?.zone ?? input.defaultZone,
      governance: declaredGovernance ?? folderMatch?.governance ?? "standard",
      level: 2,
      unconfirmed: false
    };
  }
  if (folderMatch) {
    return {
      zone: folderMatch.zone,
      governance: folderMatch.governance,
      level: 1,
      unconfirmed: false
    };
  }
  const signalZone = resolveSignalZone(
    input.contentSignals,
    input.signalZoneMap
  );
  return {
    zone: signalZone ?? input.defaultZone,
    governance: "standard",
    level: 3,
    unconfirmed: true
  };
}
function resolveSignalZone(signals, map) {
  if (!signals || signals.length === 0 || !map) return void 0;
  const priority = [
    "pii",
    "client-identifying",
    "public-facing"
  ];
  for (const sig of priority) {
    if (signals.includes(sig) && map[sig]) return map[sig];
  }
  return void 0;
}
function matchLongestFolderPattern(documentPath, patterns) {
  let best = null;
  for (const p of patterns) {
    if (documentPath.startsWith(p.path)) {
      if (!best || p.path.length > best.path.length) best = p;
    }
  }
  return best;
}
function detectZoneChallenge(input) {
  const declaredZone = input.frontmatter.zone;
  if (!declaredZone) return null;
  const folderMatch = matchLongestFolderPattern(
    input.documentPath,
    input.manifest.patterns
  );
  if (!folderMatch) return null;
  if (folderMatch.zone === declaredZone) return null;
  return {
    documentId: input.documentId,
    declaredZone,
    impliedZone: folderMatch.zone,
    declaredGovernance: input.frontmatter.governance,
    impliedGovernance: folderMatch.governance
  };
}

// src/config.ts
import yaml2 from "js-yaml";
function parseConfig(content) {
  const raw = yaml2.load(content);
  const result = nestConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid config.yaml: ${messages.join("; ")}`);
  }
  return result.data;
}
var DEFAULT_SYNTAX = {
  tokens: {
    tag: "#{{tag}}",
    pack_reference: "pack:{{pack_id}}"
  }
};
function parseSyntaxConfig(content) {
  if (!content) return DEFAULT_SYNTAX;
  const raw = yaml2.load(content);
  return {
    tokens: {
      ...DEFAULT_SYNTAX.tokens,
      ...raw?.tokens
    }
  };
}

// src/storage/nest-storage.ts
import { join as join3, dirname as dirname2, basename } from "path";
import yaml3 from "js-yaml";

// src/inline.ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
var processor = unified().use(remarkParse).use(remarkGfm);
function extractContextLinks(body) {
  const tree = processor.parse(body);
  const links = [];
  function walk(node) {
    if (node.type === "link" && typeof node.url === "string") {
      if (node.url.startsWith("contextnest://")) {
        links.push(node.url);
      }
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  walk(tree);
  return links;
}
function extractTags(body) {
  const tags = /* @__PURE__ */ new Set();
  const pattern = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    tags.add(`#${match[1]}`);
  }
  return [...tags];
}
function extractMentions(body) {
  const mentions = /* @__PURE__ */ new Set();
  const pattern = /(?:^|\s)@((?:team:)?[a-zA-Z][a-zA-Z0-9._-]*[a-zA-Z0-9])/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    mentions.add(`@${match[1]}`);
  }
  return [...mentions];
}
function countTasks(body) {
  const incomplete = (body.match(/- \[ \]/g) || []).length;
  const complete = (body.match(/- \[x\]/gi) || []).length;
  return { total: incomplete + complete, completed: complete };
}
function buildRelationships(documents) {
  const edges = [];
  for (const doc of documents) {
    const links = extractContextLinks(doc.body);
    for (const link of links) {
      let target = link.replace("contextnest://", "");
      const anchorIdx = target.indexOf("#");
      if (anchorIdx !== -1) target = target.slice(0, anchorIdx);
      const pinIdx = target.indexOf("@");
      if (pinIdx !== -1) target = target.slice(0, pinIdx);
      if (target.endsWith("/")) target = target.slice(0, -1);
      const to = target.includes("://") ? link : target;
      edges.push({ from: doc.id, to, type: "reference" });
    }
    if (doc.frontmatter.source?.depends_on) {
      for (const dep of doc.frontmatter.source.depends_on) {
        const target = dep.replace("contextnest://", "");
        edges.push({ from: doc.id, to: target, type: "depends_on" });
      }
    }
  }
  return edges;
}
function buildBacklinks(documents) {
  const backlinks = /* @__PURE__ */ new Map();
  const edges = buildRelationships(documents);
  for (const edge of edges) {
    if (edge.type === "reference") {
      const existing = backlinks.get(edge.to) || [];
      existing.push(edge.from);
      backlinks.set(edge.to, existing);
    }
  }
  return backlinks;
}
function extractSection(body, anchor) {
  const tree = processor.parse(body);
  let found = false;
  let foundDepth = 0;
  const lines = body.split("\n");
  let startLine = -1;
  let endLine = lines.length;
  for (const node of tree.children) {
    if (node.type === "heading") {
      const text = getHeadingText(node);
      const headingAnchor = text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      if (found && node.depth <= foundDepth) {
        endLine = (node.position?.start.line ?? endLine) - 1;
        break;
      }
      if (headingAnchor === anchor) {
        found = true;
        foundDepth = node.depth;
        startLine = (node.position?.start.line ?? 1) - 1;
      }
    }
  }
  if (!found) return null;
  return lines.slice(startLine, endLine).join("\n").trim();
}
function getHeadingText(node) {
  const parts = [];
  if (node.children) {
    for (const child of node.children) {
      if (child.type === "text") {
        parts.push(child.value);
      } else if (child.children) {
        parts.push(getHeadingText(child));
      }
    }
  }
  return parts.join("");
}

// src/index-generator.ts
function generateContextYaml(publishedDocuments, config, latestCheckpoint, options = {}) {
  const documents = publishedDocuments.map((doc) => {
    const entry = {
      id: doc.id,
      title: doc.frontmatter.title,
      ...doc.frontmatter.description ? { description: doc.frontmatter.description } : {},
      type: doc.frontmatter.type || "document",
      tags: stripTagPrefix(doc.frontmatter.tags || []),
      status: doc.frontmatter.status || "published",
      version: doc.frontmatter.version || 1
    };
    if (doc.frontmatter.type === "source" && doc.frontmatter.source) {
      entry.source = {
        transport: doc.frontmatter.source.transport,
        ...doc.frontmatter.source.server ? { server: doc.frontmatter.source.server } : {},
        tools: doc.frontmatter.source.tools,
        ...doc.frontmatter.source.depends_on?.length ? {
          depends_on: doc.frontmatter.source.depends_on.map(
            (d) => d.replace("contextnest://", "")
          )
        } : {},
        ...doc.frontmatter.source.cache_ttl !== void 0 ? { cache_ttl: doc.frontmatter.source.cache_ttl } : {}
      };
    }
    if (doc.frontmatter.type === "skill" && doc.frontmatter.skill) {
      entry.skill = {
        trigger: doc.frontmatter.skill.trigger,
        ...doc.frontmatter.skill.tools_required?.length ? { tools_required: doc.frontmatter.skill.tools_required } : {},
        ...doc.frontmatter.skill.output_format ? { output_format: doc.frontmatter.skill.output_format } : {}
      };
    }
    return entry;
  });
  const relationships = buildRelationships(publishedDocuments);
  const priorityByDocId = /* @__PURE__ */ new Map();
  for (const doc of publishedDocuments) {
    const ep = doc.frontmatter.metadata?.edge_priority;
    if (typeof ep === "number") {
      priorityByDocId.set(doc.id, ep);
    }
  }
  for (const edge of relationships) {
    const explicit = priorityByDocId.get(edge.from);
    if (explicit !== void 0) {
      edge.priority = explicit;
    }
  }
  const inboundCount = /* @__PURE__ */ new Map();
  for (const edge of relationships) {
    if (edge.type === "reference") {
      inboundCount.set(edge.to, (inboundCount.get(edge.to) || 0) + 1);
    }
  }
  const hubs = [...inboundCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, degree]) => ({ id, degree }));
  const mcpServers = [];
  if (config?.servers) {
    const serverUsage = /* @__PURE__ */ new Map();
    for (const doc of publishedDocuments) {
      if (doc.frontmatter.type === "source" && doc.frontmatter.source?.server) {
        const serverName = doc.frontmatter.source.server;
        if (!serverUsage.has(serverName)) {
          serverUsage.set(serverName, []);
        }
        serverUsage.get(serverName).push(doc.id);
      }
    }
    for (const [name, serverConfig] of Object.entries(config.servers)) {
      const usedBy = serverUsage.get(name);
      if (usedBy) {
        mcpServers.push({
          name,
          url: serverConfig.url,
          used_by: usedBy
        });
      }
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    version: 1,
    generated_at: now,
    checkpoint: latestCheckpoint?.checkpoint ?? 0,
    checkpoint_at: latestCheckpoint?.at ?? now,
    ...options.namespace ? { namespace: options.namespace } : {},
    ...options.federation && options.federation !== "none" ? { federation: options.federation } : {},
    documents,
    relationships,
    hubs,
    external_dependencies: {
      mcp_servers: mcpServers
    }
  };
}

// src/index-md-generator.ts
function formatUpdatedDate(value, fallback) {
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "string" && value.length > 0) {
    return value.split("T")[0];
  }
  return fallback;
}
function generateIndexMd(folderPath, folderTitle, documents, subfolders = []) {
  const now = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const sourceNodes = documents.filter((d) => d.frontmatter.type === "source");
  const regularDocs = documents.filter((d) => d.frontmatter.type !== "source");
  const lines = [];
  lines.push("---");
  lines.push(`title: "${folderTitle} Index"`);
  lines.push("type: index");
  lines.push("auto_generated: true");
  lines.push(`generated_at: ${generatedAt}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${folderTitle}`);
  lines.push("");
  if (regularDocs.length > 0) {
    lines.push("## Documents");
    lines.push("");
    lines.push("| Document | Type | Status | Tags | Updated |");
    lines.push("|----------|------|--------|------|---------|");
    for (const doc of regularDocs) {
      const title = doc.frontmatter.title;
      const uri = `contextnest://${doc.id}`;
      const type = doc.frontmatter.type || "document";
      const status = doc.frontmatter.status || "draft";
      const tags = (doc.frontmatter.tags || []).join(" ");
      const updated = formatUpdatedDate(doc.frontmatter.updated_at, now);
      lines.push(`| [${title}](${uri}) | ${type} | ${status} | ${tags} | ${updated} |`);
    }
    lines.push("");
  }
  if (sourceNodes.length > 0) {
    lines.push("## Source Nodes");
    lines.push("");
    lines.push("| Source | Transport | Server | Tools | Tags | Updated |");
    lines.push("|--------|-----------|--------|-------|------|---------|");
    for (const doc of sourceNodes) {
      const title = doc.frontmatter.title;
      const uri = `contextnest://${doc.id}`;
      const transport = doc.frontmatter.source?.transport || "";
      const server = doc.frontmatter.source?.server || "";
      const tools = (doc.frontmatter.source?.tools || []).join(", ");
      const tags = (doc.frontmatter.tags || []).join(" ");
      const updated = formatUpdatedDate(doc.frontmatter.updated_at, now);
      lines.push(
        `| [${title}](${uri}) | ${transport} | ${server} | ${tools} | ${tags} | ${updated} |`
      );
    }
    lines.push("");
    const servers = /* @__PURE__ */ new Map();
    for (const doc of sourceNodes) {
      if (doc.frontmatter.source?.server) {
        const name = doc.frontmatter.source.server;
        if (!servers.has(name)) servers.set(name, []);
        servers.get(name).push(doc.frontmatter.title);
      }
    }
    if (servers.size > 0) {
      lines.push("## External Dependencies");
      lines.push("");
      for (const [name, usedBy] of servers) {
        lines.push(`- **${name}** (MCP): Used by ${usedBy.join(", ")}`);
      }
      lines.push("");
    }
  }
  if (subfolders.length > 0) {
    lines.push("## Subfolders");
    lines.push("");
    for (const folder of subfolders) {
      const desc = folder.description ? ` - ${folder.description}` : "";
      lines.push(`- [${folder.path}](contextnest://${folder.path}/)${desc}`);
    }
    lines.push("");
  }
  const published = documents.filter(isPublished).length;
  const draft = documents.filter((d) => !isPublished(d)).length;
  lines.push("## Statistics");
  lines.push("");
  lines.push(`- Total documents: ${documents.length}`);
  if (published > 0) lines.push(`- Published: ${published}`);
  if (draft > 0) lines.push(`- Draft: ${draft}`);
  lines.push("");
  const allTags = /* @__PURE__ */ new Set();
  for (const doc of documents) {
    for (const tag of doc.frontmatter.tags || []) {
      allTags.add(tag);
    }
  }
  if (allTags.size > 0) {
    lines.push("## Tags in this folder");
    lines.push("");
    lines.push([...allTags].sort().join(" "));
    lines.push("");
  }
  return lines.join("\n");
}

// src/agent-configs.ts
var SECTION_BEGIN = "<!-- BEGIN CONTEXT NEST (auto-generated, do not edit this section) -->";
var SECTION_END = "<!-- END CONTEXT NEST -->";
var DEFAULT_MAINTENANCE_DIRECTIVE = `## Maintaining This Nest

This project has a Context Nest vault. As the agent working with the user on
this project, YOU are responsible for KEEPING IT USEFUL. This is not optional \u2014
without active maintenance the nest decays and the user loses the second-brain
value they installed it for.

Capture aggressively. Multiple nodes per session is normal and expected.
Under-capture is the failure mode here, not over-capture.

What to capture:

- **Information you uncovered** about the codebase, the domain, or how things
  actually work \u2014 anything the next session would benefit from knowing
  without rediscovering.
- **Decisions** the user makes (architectural, technical, product) and the
  reasoning behind them. Even small ones.
- **Gotchas, surprises, and tribal knowledge** \u2014 anything that took more
  than a moment to figure out, anything the user said in passing that's
  worth not losing.
- **Answers** you and the user worked out together that would be useful
  next time the same question comes up.
- **References** the user shared (URLs, file paths, screenshots, pasted
  threads) \u2014 anchor them in a node so they don't disappear into chat history.

How to capture:

- You do not need permission to capture. You may capture without asking.
  Mention what you're capturing in passing if it's substantive \u2014 do not gate
  the capture on a yes/no from the user.
- Use \`ctx add nodes/<slug> --type document --title "<title>" --tags
  "<tags>"\` to create. Write the body with the Write tool. Keep nodes tight \u2014
  100-300 words is usually plenty.
- Show what you wrote only if asked, or if the content is ambiguous and
  the user should review.
- Every change is hash-chained and versioned silently. The user can inspect
  or revert later. There is no cost to capturing too much; there is real
  cost to capturing too little.
`;
function generateAgentConfigs(input) {
  const core = buildCoreInstructions(input);
  const section = `${SECTION_BEGIN}
${core}
${SECTION_END}`;
  return [
    { path: "CLAUDE.md", content: section },
    { path: "GEMINI.md", content: section },
    { path: ".cursorrules", content: section },
    { path: ".windsurfrules", content: section },
    { path: ".github/copilot-instructions.md", content: section }
  ];
}
function mergeAgentConfig(existingContent, newSection) {
  if (!existingContent) {
    return newSection + "\n";
  }
  const beginIdx = existingContent.indexOf(SECTION_BEGIN);
  const endIdx = existingContent.indexOf(SECTION_END);
  if (beginIdx !== -1 && endIdx !== -1) {
    const before = existingContent.slice(0, beginIdx).trimEnd();
    const after = existingContent.slice(endIdx + SECTION_END.length).trimStart();
    const parts = [before, newSection, after].filter((p) => p.length > 0);
    return parts.join("\n\n") + "\n";
  }
  return existingContent.trimEnd() + "\n\n" + newSection + "\n";
}
function buildCoreInstructions(input) {
  const { config, contextYaml, packs, hasMcpServer } = input;
  const vaultName = config?.name || "Context Nest Vault";
  const lines = [];
  lines.push(`# ${vaultName}`);
  lines.push("");
  lines.push("This project contains a **Context Nest vault** \u2014 a structured knowledge base");
  lines.push("you should query before answering questions about this codebase or domain.");
  lines.push("");
  lines.push("## How to Use This Vault");
  lines.push("");
  if (hasMcpServer) {
    lines.push("**Preferred: MCP Server** \u2014 Use the `contextnest` MCP tools (`resolve`, `read_document`, `search`).");
    lines.push("");
  }
  lines.push("**CLI fallback** \u2014 Run `ctx query <selector>` to load context:");
  lines.push("```");
  lines.push('ctx query "#topic"              # By tag');
  lines.push('ctx query "type:document"        # By type');
  lines.push('ctx query "pack:pack-name"       # Load a pack');
  lines.push('ctx query "#tag" --hops 3        # Deeper graph traversal');
  lines.push('ctx query "#tag" --full           # Load everything (large vaults)');
  lines.push("```");
  lines.push("");
  const directive = config?.agent_maintenance_directive ?? DEFAULT_MAINTENANCE_DIRECTIVE;
  lines.push(directive.trim());
  lines.push("");
  if (contextYaml.hubs.length > 0) {
    lines.push("## Start Here (Hub Documents)");
    lines.push("");
    lines.push("These are the most-referenced documents \u2014 start with these for broad context:");
    lines.push("");
    for (const hub of contextYaml.hubs.slice(0, 5)) {
      const doc = contextYaml.documents.find((d) => d.id === hub.id);
      const title = doc?.title || hub.id;
      lines.push(`- **${title}** \u2014 \`ctx query "contextnest://${hub.id}"\``);
    }
    lines.push("");
  }
  if (packs.length > 0) {
    lines.push("## Context Packs");
    lines.push("");
    lines.push("Pre-curated bundles of context for common tasks:");
    lines.push("");
    for (const pack of packs) {
      lines.push(`- **${pack.label}** (\`pack:${pack.id}\`) \u2014 ${pack.description || "No description"}`);
    }
    lines.push("");
  }
  lines.push("## Vault Overview");
  lines.push("");
  const published = contextYaml.documents.filter((d) => d.status === "published").length;
  const drafts = contextYaml.documents.length - published;
  lines.push(`- **${published}** published documents, **${drafts}** drafts`);
  lines.push(`- **${contextYaml.relationships.length}** relationship edges`);
  const tags = /* @__PURE__ */ new Set();
  for (const doc of contextYaml.documents) {
    for (const tag of doc.tags) tags.add(tag);
  }
  if (tags.size > 0) {
    lines.push(`- Tags: ${[...tags].sort().map((t) => `\`#${t}\``).join(", ")}`);
  }
  lines.push("");
  lines.push("## Rules");
  lines.push("");
  lines.push("1. **Query before answering** \u2014 Always check the vault for relevant context before responding to domain questions");
  lines.push("2. **Cite sources** \u2014 Reference document paths when using vault content");
  lines.push("3. **Prefer published** \u2014 Use published documents over drafts");
  lines.push("4. **Use graph traversal** \u2014 Default `ctx query` follows the document graph; increase `--hops` if you need more context");
  lines.push("");
  return lines.join("\n");
}

// src/storage/providers/fs-storage-provider.ts
import {
  readFile,
  writeFile,
  mkdir,
  unlink,
  rename,
  rm,
  access
} from "fs/promises";
import { join as join2, dirname } from "path";
import fg from "fast-glob";
var FsStorageProvider = class {
  constructor(root) {
    this.root = root;
  }
  root;
  abs(path) {
    return join2(this.root, path);
  }
  async read(path) {
    try {
      return await readFile(this.abs(path));
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }
  async write(path, data) {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
  }
  async delete(path) {
    try {
      await unlink(this.abs(path));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  async deleteDir(prefix) {
    try {
      await rm(this.abs(prefix), { recursive: true, force: true });
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  async rename(from, to) {
    const absDest = this.abs(to);
    await mkdir(dirname(absDest), { recursive: true });
    await rename(this.abs(from), absDest);
  }
  async list(pattern) {
    const results = await fg(pattern, { cwd: this.root, onlyFiles: true });
    return results.sort();
  }
  async exists(path) {
    try {
      await access(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }
};

// src/storage/nest-storage.ts
var UNSTAGED_DRIFT_SENTINEL = "unstaged-drift";
var NestStorage = class {
  provider;
  root;
  constructor(rootOrProvider) {
    if (typeof rootOrProvider === "string") {
      this.root = rootOrProvider;
      this.provider = new FsStorageProvider(rootOrProvider);
    } else {
      this.root = "";
      this.provider = rootOrProvider;
    }
  }
  /**
   * Detect layout mode. If nodes/ directory exists, structured; otherwise Obsidian.
   */
  async detectLayout() {
    const exists = await this.provider.exists("nodes");
    return exists ? "structured" : "obsidian";
  }
  /**
   * Discover all markdown documents in the vault.
   * Skips hidden directories (.-prefixed) and node_modules.
   */
  async discoverDocuments() {
    const layout = await this.detectLayout();
    let patterns;
    if (layout === "structured") {
      patterns = ["nodes/**/*.md", "sources/**/*.md"];
    } else {
      patterns = ["**/*.md"];
    }
    const allFiles = [];
    for (const pattern of patterns) {
      const files = await this.provider.list(pattern);
      allFiles.push(...files);
    }
    const filtered = allFiles.filter(
      (f) => !f.includes("node_modules/") && !f.includes("/.versions/") && !f.includes("/.context/") && f !== "INDEX.md" && !f.endsWith("/INDEX.md") && f !== "CONTEXT.md" && f !== "context.yaml" && // skip dot-prefixed path segments (hidden dirs)
      !f.split("/").some((seg) => seg.startsWith("."))
    ).sort();
    const nodes = [];
    for (const file of filtered) {
      const buf = await this.provider.read(file);
      if (buf === null) continue;
      const content = buf.toString("utf-8");
      const id = file.replace(/\.md$/, "");
      const filePath = this.root ? join3(this.root, file) : file;
      nodes.push(parseDocument(filePath, content, id));
    }
    return nodes;
  }
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
  async readDocument(id, options = {}) {
    const relPath = `${id}.md`;
    const filePath = this.root ? join3(this.root, relPath) : relPath;
    const buf = await this.provider.read(relPath);
    if (buf === null) {
      throw new DocumentNotFoundError(id);
    }
    const liveContent = buf.toString("utf-8");
    const liveNode = parseDocument(filePath, liveContent, id);
    if (!options.verifyChecksum) {
      return liveNode;
    }
    const drift = detectDrift(liveContent, liveNode.frontmatter.checksum);
    if (!drift.drifted) {
      return liveNode;
    }
    const approved = await this.readLatestApprovedKeyframe(id);
    const pendingChange = {
      suggestion_id: UNSTAGED_DRIFT_SENTINEL,
      detected_at: (/* @__PURE__ */ new Date()).toISOString(),
      source: "out-of-band-edit",
      proposed_hash: drift.actualHash
    };
    if (approved) {
      const approvedNode = parseDocument(filePath, approved.content, id);
      return { ...approvedNode, pendingChange };
    }
    return { ...liveNode, pendingChange };
  }
  /**
   * Compute drift for a document without touching the live file (read-only).
   * Returns `null` when the document does not exist.
   *
   * Useful for the checkpoint hook and background hygienist (step 9 / 10).
   */
  async detectDocumentDrift(id) {
    const relPath = `${id}.md`;
    const filePath = this.root ? join3(this.root, relPath) : relPath;
    const buf = await this.provider.read(relPath);
    if (buf === null) {
      return null;
    }
    const liveContent = buf.toString("utf-8");
    const liveNode = parseDocument(filePath, liveContent, id);
    return detectDrift(liveContent, liveNode.frontmatter.checksum);
  }
  /**
   * Regenerate derived vault files after any mutation: context.yaml,
   * per-folder INDEX.md, and agent-config files (CLAUDE.md, GEMINI.md,
   * .cursorrules, etc.).
   *
   * Single source for mcp-server, cli, and desktop. Each agent-config file
   * is merged with its existing on-disk content so user-authored sections
   * outside engine-managed blocks are preserved.
   */
  async regenerateIndex() {
    const docs = await this.discoverDocuments();
    const config = await this.readConfig();
    const checkpointHistory = await this.readCheckpointHistory();
    const latestCheckpoint = checkpointHistory?.checkpoints?.at(-1) ?? null;
    const published = docs.filter((d) => d.frontmatter.status === "published");
    const packs = await this.readPacks();
    const contextYaml = generateContextYaml(published, config, latestCheckpoint);
    await this.writeContextYaml(contextYaml);
    const folders = /* @__PURE__ */ new Map();
    for (const doc of docs) {
      const parts = doc.id.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder).push(doc);
    }
    for (const [folder, folderDocs] of folders) {
      if (folder === ".") continue;
      const title = folder.split("/").pop().replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const indexMd = generateIndexMd(folder, title, folderDocs);
      await this.writeIndexMd(folder, indexMd);
    }
    const hasMcpServer = !!(config?.servers && Object.keys(config.servers).length > 0);
    const agentConfigs = generateAgentConfigs({
      config,
      contextYaml,
      packs,
      hasMcpServer
    });
    for (const file of agentConfigs) {
      const existingBuf = await this.provider.read(file.path);
      const existing = existingBuf ? existingBuf.toString("utf-8") : null;
      const merged = mergeAgentConfig(existing, file.content);
      await this.provider.write(file.path, Buffer.from(merged, "utf-8"));
    }
  }
  /**
   * Full vault integrity check: document chains, checkpoint chain, and
   * live-body drift against stored frontmatter checksums.
   *
   * Single entry point used by mcp-server, cli, desktop. Detects:
   *   - content_hash_mismatch / chain_hash_mismatch in version history
   *   - cross_chain_mismatch / checkpoint_hash_mismatch in checkpoints
   *   - body_drift when live `.md` body sha256 != frontmatter.checksum
   */
  async verifyVaultIntegrity() {
    const allHistories = await this.findAllHistories();
    const checkpointHistory = await this.readCheckpointHistory();
    const errors = [];
    for (const [docId, history] of allHistories) {
      const report = verifyDocumentChain(docId, history, (_v) => null);
      if (!report.valid) errors.push(...report.errors);
    }
    if (checkpointHistory) {
      const report = verifyCheckpointChain(
        checkpointHistory.checkpoints,
        allHistories
      );
      if (!report.valid) errors.push(...report.errors);
    }
    const liveDocs = await this.discoverDocuments();
    for (const doc of liveDocs) {
      const drift = await this.detectDocumentDrift(doc.id);
      if (drift && drift.drifted) {
        errors.push({
          type: "body_drift",
          document: doc.id,
          expected: drift.storedHash,
          actual: drift.actualHash
        });
      }
    }
    return { valid: errors.length === 0, errors };
  }
  /**
   * Return the most recent keyframe content for a document, if any.
   * Walks the history backward looking for the last `keyframe: true` entry
   * with an extant `v{N}.md` file. Returns `null` for legacy docs with no
   * history or no keyframes on disk.
   */
  async readLatestApprovedKeyframe(id) {
    const history = await this.readHistory(id);
    if (!history || history.versions.length === 0) return null;
    for (let i = history.versions.length - 1; i >= 0; i--) {
      const entry = history.versions[i];
      if (!entry.keyframe) continue;
      const content = await this.readKeyframe(id, entry.version);
      if (content !== null) {
        return { version: entry.version, content };
      }
    }
    return null;
  }
  /**
   * Write a document to disk.
   */
  async writeDocument(id, content) {
    await this.provider.write(`${id}.md`, Buffer.from(content, "utf-8"));
  }
  /**
   * Delete a document and its version history from the vault.
   */
  async deleteDocument(id) {
    const relPath = `${id}.md`;
    const exists = await this.provider.exists(relPath);
    if (!exists) {
      throw new DocumentNotFoundError(id);
    }
    await this.provider.delete(relPath);
    const docName = basename(id);
    const docDir = dirname2(id);
    const versionsRelDir = docDir === "." ? `.versions/${docName}` : `${docDir}/.versions/${docName}`;
    await this.provider.deleteDir(versionsRelDir);
  }
  /**
   * Batch-read documents by ID. Only loads bodies for requested IDs.
   * Parallelizes reads for performance. Missing documents are silently skipped.
   */
  async readDocuments(ids) {
    const results = /* @__PURE__ */ new Map();
    const reads = ids.map(async (id) => {
      try {
        const doc = await this.readDocument(id);
        results.set(id, doc);
      } catch {
      }
    });
    await Promise.all(reads);
    return results;
  }
  /**
   * Read CONTEXT.md vault identity file (§1.2).
   */
  async readContextMd() {
    const buf = await this.provider.read("CONTEXT.md");
    return buf ? buf.toString("utf-8") : null;
  }
  /**
   * Read .context/config.yaml (§11.1).
   */
  async readConfig() {
    const buf = await this.provider.read(".context/config.yaml");
    if (buf === null) return null;
    return parseConfig(buf.toString("utf-8"));
  }
  /**
   * Read context.yaml (§5).
   */
  async readContextYaml() {
    const buf = await this.provider.read("context.yaml");
    if (buf === null) return null;
    return yaml3.load(buf.toString("utf-8"));
  }
  /**
   * Write context.yaml.
   */
  async writeContextYaml(data) {
    const content = "# Auto-generated. Do not edit manually.\n" + yaml3.dump(data, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });
    await this.provider.write("context.yaml", Buffer.from(content, "utf-8"));
  }
  /**
   * Read document history from .versions/{docName}/history.yaml (§6.2).
   */
  async readHistory(docId) {
    const docName = basename(docId);
    const docDir = dirname2(docId);
    const historyRelPath = docDir === "." ? `.versions/${docName}/history.yaml` : `${docDir}/.versions/${docName}/history.yaml`;
    const buf = await this.provider.read(historyRelPath);
    if (buf === null) return null;
    const raw = yaml3.load(buf.toString("utf-8"));
    const result = documentHistorySchema.safeParse(raw);
    return result.success ? result.data : null;
  }
  /**
   * Write document history to .versions/{docName}/history.yaml.
   */
  async writeHistory(docId, history) {
    const docName = basename(docId);
    const docDir = dirname2(docId);
    const historyRelPath = docDir === "." ? `.versions/${docName}/history.yaml` : `${docDir}/.versions/${docName}/history.yaml`;
    const content = yaml3.dump(history, { lineWidth: -1, noRefs: true });
    await this.provider.write(historyRelPath, Buffer.from(content, "utf-8"));
  }
  /**
   * Read a keyframe version file.
   */
  async readKeyframe(docId, version) {
    const docName = basename(docId);
    const docDir = dirname2(docId);
    const keyframeRelPath = docDir === "." ? `.versions/${docName}/v${version}.md` : `${docDir}/.versions/${docName}/v${version}.md`;
    const buf = await this.provider.read(keyframeRelPath);
    return buf ? buf.toString("utf-8") : null;
  }
  /**
   * Write a keyframe version file.
   */
  async writeKeyframe(docId, version, content) {
    const docName = basename(docId);
    const docDir = dirname2(docId);
    const keyframeRelPath = docDir === "." ? `.versions/${docName}/v${version}.md` : `${docDir}/.versions/${docName}/v${version}.md`;
    await this.provider.write(keyframeRelPath, Buffer.from(content, "utf-8"));
  }
  /**
   * Path layout for staged suggestions (bridge-function-spec Story 3.1):
   *
   *   {docDir}/_suggestions/{docName}/{suggestionId}.patch
   *   {docDir}/_suggestions/{docName}/{suggestionId}.meta.yaml
   *
   * Mirrors the `.versions/` layout for consistency.
   * Returns a vault-relative path prefix.
   */
  suggestionDir(docId) {
    const docName = basename(docId);
    const docDir = dirname2(docId);
    return docDir === "." ? `_suggestions/${docName}` : `${docDir}/_suggestions/${docName}`;
  }
  /** Write a unified-diff patch for a staged suggestion. */
  async writeSuggestionPatch(docId, suggestionId, patch) {
    const dir = this.suggestionDir(docId);
    const relPath = `${dir}/${suggestionId}.patch`;
    await this.provider.write(relPath, Buffer.from(patch, "utf-8"));
    return this.root ? join3(this.root, relPath) : relPath;
  }
  /** Write the YAML meta record for a staged suggestion. */
  async writeSuggestionMeta(docId, suggestionId, meta) {
    const dir = this.suggestionDir(docId);
    const relPath = `${dir}/${suggestionId}.meta.yaml`;
    const content = yaml3.dump(meta, { lineWidth: -1, noRefs: true });
    await this.provider.write(relPath, Buffer.from(content, "utf-8"));
    return this.root ? join3(this.root, relPath) : relPath;
  }
  /** Read a staged suggestion's patch text, or null when absent. */
  async readSuggestionPatch(docId, suggestionId) {
    const dir = this.suggestionDir(docId);
    const buf = await this.provider.read(`${dir}/${suggestionId}.patch`);
    return buf ? buf.toString("utf-8") : null;
  }
  /** Read a staged suggestion's parsed meta, or null when absent. */
  async readSuggestionMeta(docId, suggestionId) {
    const dir = this.suggestionDir(docId);
    const buf = await this.provider.read(`${dir}/${suggestionId}.meta.yaml`);
    if (buf === null) return null;
    return yaml3.load(buf.toString("utf-8"));
  }
  /** List all suggestion IDs staged for a document, sorted by file name. */
  async listSuggestionIds(docId) {
    const dir = this.suggestionDir(docId);
    const files = await this.provider.list(`${dir}/*.meta.yaml`).catch(
      () => []
    );
    return files.map((f) => basename(f).replace(/\.meta\.yaml$/, "")).sort();
  }
  /**
   * Move a staged suggestion's patch + meta files into the per-doc archive
   * (hootie-inbox-spec §7: governance history permanently retained).
   *
   * Layout: `{docDir}/_suggestions/{docName}/_archive/{kind}/{id}.{patch|meta.yaml}`.
   * Returns the absolute archive directory (or relative when root is empty).
   */
  async archiveSuggestion(docId, suggestionId, kind) {
    const srcDir = this.suggestionDir(docId);
    const destDir = `${srcDir}/_archive/${kind}`;
    await this.provider.rename(
      `${srcDir}/${suggestionId}.patch`,
      `${destDir}/${suggestionId}.patch`
    );
    await this.provider.rename(
      `${srcDir}/${suggestionId}.meta.yaml`,
      `${destDir}/${suggestionId}.meta.yaml`
    );
    return this.root ? join3(this.root, destDir) : destDir;
  }
  /**
   * Read checkpoint history from .versions/context_history.yaml (§7.2).
   */
  async readCheckpointHistory() {
    const buf = await this.provider.read(".versions/context_history.yaml");
    if (buf === null) return null;
    const raw = yaml3.load(buf.toString("utf-8"));
    const result = checkpointHistorySchema.safeParse(raw);
    return result.success ? result.data : null;
  }
  /**
   * Write checkpoint history.
   */
  async writeCheckpointHistory(history) {
    const content = "# Auto-generated. Do not edit manually.\n" + yaml3.dump(history, { lineWidth: -1, noRefs: true });
    await this.provider.write(
      ".versions/context_history.yaml",
      Buffer.from(content, "utf-8")
    );
  }
  /**
   * Path to the chain-events log file (zone-classification-rbac-spec §6,
   * hootie-inbox-spec §8). Lives alongside the checkpoint history.
   */
  chainEventLogRelPath() {
    return ".versions/chain_events.yaml";
  }
  /**
   * Read the raw chain-event log. Returns an empty array if the file is
   * absent or unreadable. Callers should validate entries via
   * `hashChainEventSchema` before consuming — this method does not
   * schema-check, to stay symmetric with the other low-level readers.
   */
  async readChainEventLog() {
    const buf = await this.provider.read(this.chainEventLogRelPath());
    if (buf === null) return [];
    const raw = yaml3.load(buf.toString("utf-8"));
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object" && Array.isArray(raw.events)) {
      return raw.events;
    }
    return [];
  }
  /**
   * Append a single chain event to the log. Atomic at the YAML-document
   * level (write a fresh full file each time). Caller is responsible for
   * ensuring the event is schema-valid.
   */
  async appendChainEvent(event) {
    const existing = await this.readChainEventLog();
    existing.push(event);
    const content = "# Hash chain events \u2014 append only. Do not edit manually.\n" + yaml3.dump(existing, { lineWidth: -1, noRefs: true });
    await this.provider.write(
      this.chainEventLogRelPath(),
      Buffer.from(content, "utf-8")
    );
  }
  /**
   * Read all packs from packs/ directory (§3).
   */
  async readPacks() {
    const packFiles = await this.provider.list("packs/**/*.yml");
    const packs = [];
    for (const file of packFiles.sort()) {
      const buf = await this.provider.read(file);
      if (buf === null) continue;
      const raw = yaml3.load(buf.toString("utf-8"));
      const result = packSchema.safeParse(raw);
      if (result.success) {
        packs.push(result.data);
      }
    }
    return packs;
  }
  /**
   * Write an INDEX.md file.
   */
  async writeIndexMd(folder, content) {
    await this.provider.write(`${folder}/INDEX.md`, Buffer.from(content, "utf-8"));
  }
  /**
   * Write CONTEXT.md.
   */
  async writeContextMd(content) {
    await this.provider.write("CONTEXT.md", Buffer.from(content, "utf-8"));
  }
  /**
   * Write .context/config.yaml.
   */
  async writeConfig(config) {
    const content = yaml3.dump(config, { lineWidth: -1, noRefs: true });
    await this.provider.write(".context/config.yaml", Buffer.from(content, "utf-8"));
  }
  /**
   * Find all document history files across the nest.
   * Used for checkpoint rebuild (§7.3).
   */
  async findAllHistories() {
    const historyFiles = await this.provider.list("**/.versions/*/history.yaml");
    const histories = /* @__PURE__ */ new Map();
    for (const file of historyFiles) {
      const parts = file.split("/");
      const versionsIdx = parts.indexOf(".versions");
      if (versionsIdx === -1) continue;
      const docDir = parts.slice(0, versionsIdx).join("/");
      const docName = parts[versionsIdx + 1];
      const docId = docDir ? `${docDir}/${docName}` : docName;
      const buf = await this.provider.read(file);
      if (buf === null) continue;
      const raw = yaml3.load(buf.toString("utf-8"));
      const result = documentHistorySchema.safeParse(raw);
      if (result.success) {
        histories.set(docId, result.data);
      }
    }
    return histories;
  }
  /**
   * Initialize a new vault with the given layout mode.
   */
  async init(name, layout = "structured") {
    if (layout === "structured") {
      await this.provider.write("nodes/.gitkeep", Buffer.alloc(0));
      await this.provider.write("sources/.gitkeep", Buffer.alloc(0));
      await this.provider.write("packs/.gitkeep", Buffer.alloc(0));
    }
    const config = {
      version: 1,
      name,
      defaults: { status: "draft" }
    };
    await this.writeConfig(config);
    const contextMd = `---
title: "${name}"
---

# ${name}

## How to Use This Vault

1. Read \`.context/config.yaml\` for nest configuration and folder descriptions
2. Read \`INDEX.md\` for a summary of all documents, their types, status, and tags
3. Use \`context.yaml\` to understand the document graph
4. Start with hub documents (highest inbound links) for broad context
5. Follow \`contextnest://\` links within documents to traverse related content

## Operating Instructions

- Always cite sources by document path
- Prefer published documents over drafts
`;
    await this.writeContextMd(contextMd);
  }
};

// src/storage/storage-factory.ts
function createStorageProvider(config) {
  if (config.backend === "fs") {
    if (!config.vaultPath) throw new Error("vaultPath required for fs backend");
    return new FsStorageProvider(config.vaultPath);
  }
  throw new Error(`Unknown storage backend: "${config.backend}". Register custom backends in your host application.`);
}

// src/uri.ts
var URI_PREFIX = "contextnest://";
function parseUri(raw) {
  if (!raw.startsWith(URI_PREFIX)) {
    throw new InvalidUriError(raw, "URI must start with contextnest://");
  }
  let remainder = raw.slice(URI_PREFIX.length);
  if (!remainder) {
    throw new InvalidUriError(raw, "URI path cannot be empty");
  }
  if (remainder.includes("//")) {
    throw new InvalidUriError(raw, "Consecutive slashes are not allowed");
  }
  if (remainder.startsWith("tag/")) {
    const tagName = remainder.slice(4);
    if (!tagName) {
      throw new InvalidUriError(raw, "Tag name cannot be empty");
    }
    return { path: remainder, kind: "tag" };
  }
  if (remainder.startsWith("search/")) {
    const query = remainder.slice(7);
    if (!query) {
      throw new InvalidUriError(raw, "Search query cannot be empty");
    }
    return { path: remainder, kind: "search" };
  }
  if (remainder.endsWith("/")) {
    const folderPath = remainder.slice(0, -1);
    if (!folderPath) {
      throw new InvalidUriError(raw, "Folder path cannot be empty");
    }
    return { path: folderPath, kind: "folder" };
  }
  let anchor;
  const anchorIdx = remainder.indexOf("#");
  if (anchorIdx !== -1) {
    anchor = remainder.slice(anchorIdx + 1);
    if (!anchor) {
      throw new InvalidUriError(raw, "Empty anchor (#) is not allowed (\xA74.3)");
    }
    remainder = remainder.slice(0, anchorIdx);
  }
  let checkpoint;
  const pinIdx = remainder.indexOf("@");
  if (pinIdx !== -1) {
    const pinStr = remainder.slice(pinIdx + 1);
    remainder = remainder.slice(0, pinIdx);
    if (!/^\d+$/.test(pinStr)) {
      throw new InvalidUriError(raw, "Checkpoint pin must be a non-negative integer");
    }
    if (pinStr.length > 1 && pinStr.startsWith("0")) {
      throw new InvalidUriError(raw, "Checkpoint pin must not have leading zeros");
    }
    checkpoint = parseInt(pinStr, 10);
    if (checkpoint === 0) {
      throw new InvalidUriError(raw, "@0 is reserved and must not be used");
    }
  }
  let namespace;
  try {
    remainder = decodeURIComponent(remainder);
  } catch {
    throw new InvalidUriError(raw, "Invalid percent-encoding in URI");
  }
  const segments = remainder.split("/").filter(Boolean);
  const resolved = [];
  for (const seg of segments) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (resolved.length === 0) {
        throw new InvalidUriError(raw, "URI path escapes nest root via '..'");
      }
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  if (resolved.length === 0) {
    throw new InvalidUriError(raw, "URI path resolves to empty after dot segment resolution");
  }
  const path = resolved.join("/");
  return {
    namespace,
    path,
    checkpoint,
    anchor,
    kind: "document"
  };
}
function canonicalizeUri(uri) {
  let result = URI_PREFIX;
  if (uri.namespace) {
    result += uri.namespace.toLowerCase() + "/";
  }
  result += uri.path;
  if (uri.kind === "folder") {
    result += "/";
  }
  if (uri.checkpoint !== void 0) {
    result += `@${uri.checkpoint}`;
  }
  if (uri.anchor) {
    result += `#${uri.anchor}`;
  }
  return result;
}
function serializeUri(uri) {
  return canonicalizeUri(uri);
}
function extractPath(uriStr) {
  const uri = parseUri(uriStr);
  return uri.path;
}

// src/resolver.ts
import MiniSearch from "minisearch";
var Resolver = class {
  documents;
  tagIndex;
  searchIndex;
  checkpoints;
  reconstructVersion;
  constructor(options) {
    this.documents = /* @__PURE__ */ new Map();
    this.tagIndex = /* @__PURE__ */ new Map();
    this.checkpoints = options.checkpoints || [];
    this.reconstructVersion = options.reconstructVersion;
    for (const doc of options.documents) {
      this.documents.set(doc.id, doc);
      for (const normalized of stripTagPrefix(doc.frontmatter.tags || [])) {
        if (!this.tagIndex.has(normalized)) {
          this.tagIndex.set(normalized, /* @__PURE__ */ new Set());
        }
        this.tagIndex.get(normalized).add(doc.id);
      }
    }
    this.searchIndex = new MiniSearch({
      fields: ["title", "description", "body", "tags"],
      storeFields: ["id"],
      idField: "id"
    });
    const searchDocs = options.documents.filter(isPublished).map((d) => ({
      id: d.id,
      title: d.frontmatter.title,
      description: d.frontmatter.description || "",
      body: d.body,
      tags: (d.frontmatter.tags || []).join(" ")
    }));
    this.searchIndex.addAll(searchDocs);
  }
  /**
   * Resolve a parsed URI to matching documents.
   * Only returns published documents by default.
   */
  async resolve(uri, options = {}) {
    if (uri.namespace) {
      throw new FederationNotSupportedError(uri.namespace);
    }
    switch (uri.kind) {
      case "document":
        return this.resolveDocument(uri, options);
      case "tag":
        return this.resolveTag(uri, options);
      case "folder":
        return this.resolveFolder(uri, options);
      case "search":
        return this.resolveSearch(uri);
      default:
        return [];
    }
  }
  async resolveDocument(uri, options) {
    if (uri.checkpoint !== void 0) {
      return this.resolvePinned(uri);
    }
    const doc = this.documents.get(uri.path);
    if (!doc) return [];
    if (!options.includeDrafts && !isPublished(doc)) {
      return [];
    }
    if (uri.anchor) {
      const section = extractSection(doc.body, uri.anchor);
      if (section === null) return [];
      return [{ ...doc, body: section }];
    }
    return [doc];
  }
  async resolvePinned(uri) {
    const checkpoint = this.checkpoints.find(
      (c) => c.checkpoint === uri.checkpoint
    );
    if (!checkpoint) return [];
    const version = checkpoint.document_versions[uri.path];
    if (version === void 0) return [];
    if (!this.reconstructVersion) return [];
    const content = await this.reconstructVersion(uri.path, version);
    const doc = this.documents.get(uri.path);
    if (!doc) return [];
    return [{ ...doc, body: content, rawContent: content }];
  }
  resolveTag(uri, options) {
    const tagName = uri.path.slice(4);
    const docIds = this.tagIndex.get(tagName);
    if (!docIds) return [];
    return [...docIds].map((id) => this.documents.get(id)).filter((d) => options.includeDrafts || isPublished(d));
  }
  resolveFolder(uri, options) {
    const prefix = uri.path + "/";
    return [...this.documents.values()].filter(
      (d) => (d.id.startsWith(prefix) || d.id.startsWith(uri.path)) && (options.includeDrafts || isPublished(d))
    );
  }
  resolveSearch(uri) {
    const query = uri.path.slice(7).replace(/\+/g, " ");
    const results = this.searchIndex.search(query);
    return results.map((r) => this.documents.get(r.id)).filter((d) => d !== void 0);
  }
  /** Get a document by id (no filtering) */
  getDocument(id) {
    return this.documents.get(id);
  }
  /** Get all published documents */
  getPublishedDocuments() {
    return [...this.documents.values()].filter(isPublished);
  }
  /** Get all documents */
  getAllDocuments() {
    return [...this.documents.values()];
  }
};

// src/selector/evaluator.ts
async function evaluate(node, options) {
  const allDocs = options.resolver.getAllDocuments();
  const resultIds = await evaluateNode(node, allDocs, options);
  return allDocs.filter((d) => resultIds.has(d.id));
}
async function evaluateNode(node, allDocs, options) {
  switch (node.type) {
    case "tag":
      return evaluateTag(node.value, allDocs);
    case "uri":
      return evaluateUri(node.value, options);
    case "pack":
      return evaluatePack(node.value, allDocs, options);
    case "typeFilter":
      return evaluateTypeFilter(node.value, allDocs);
    case "statusFilter":
      return evaluateStatusFilter(node.value, allDocs);
    case "transportFilter":
      return evaluateTransportFilter(node.value, allDocs);
    case "serverFilter":
      return evaluateServerFilter(node.value, allDocs);
    case "and": {
      const left = await evaluateNode(node.left, allDocs, options);
      const right = await evaluateNode(node.right, allDocs, options);
      return intersection(left, right);
    }
    case "or": {
      const left = await evaluateNode(node.left, allDocs, options);
      const right = await evaluateNode(node.right, allDocs, options);
      return union(left, right);
    }
    case "not": {
      const left = await evaluateNode(node.left, allDocs, options);
      const right = await evaluateNode(node.right, allDocs, options);
      return difference(left, right);
    }
  }
}
function evaluateTag(tag, docs) {
  const result = /* @__PURE__ */ new Set();
  for (const doc of docs) {
    const docTags = stripTagPrefix(doc.frontmatter.tags || []);
    if (docTags.includes(tag)) {
      result.add(doc.id);
    }
  }
  return result;
}
async function evaluateUri(uri, options) {
  const parsed = parseUri(uri);
  const resolved = await options.resolver.resolve(parsed, { includeDrafts: true });
  return new Set(resolved.map((d) => d.id));
}
async function evaluatePack(packId, allDocs, options) {
  if (!options.packLoader) return /* @__PURE__ */ new Set();
  const pack = options.packLoader(packId);
  if (!pack) return /* @__PURE__ */ new Set();
  let result = /* @__PURE__ */ new Set();
  if (pack.query) {
    const { parseSelector: parseSelector2 } = await import("./parser-ZUZNXYQ4.js");
    const ast = parseSelector2(pack.query);
    result = await evaluateNode(ast, allDocs, options);
  }
  if (pack.includes) {
    for (const uri of pack.includes) {
      const parsed = parseUri(uri);
      const resolved = await options.resolver.resolve(parsed, { includeDrafts: true });
      for (const doc of resolved) {
        result.add(doc.id);
      }
    }
  }
  if (pack.excludes) {
    for (const uri of pack.excludes) {
      const parsed = parseUri(uri);
      const resolved = await options.resolver.resolve(parsed, { includeDrafts: true });
      for (const doc of resolved) {
        result.delete(doc.id);
      }
    }
  }
  if (pack.filters?.node_types) {
    const allowedTypes = new Set(pack.filters.node_types);
    for (const id of result) {
      const doc = allDocs.find((d) => d.id === id);
      if (doc && !allowedTypes.has(doc.frontmatter.type || "document")) {
        result.delete(id);
      }
    }
  }
  return result;
}
function evaluateTypeFilter(type, docs) {
  const result = /* @__PURE__ */ new Set();
  for (const doc of docs) {
    if ((doc.frontmatter.type || "document") === type) {
      result.add(doc.id);
    }
  }
  return result;
}
function evaluateStatusFilter(status, docs) {
  const result = /* @__PURE__ */ new Set();
  for (const doc of docs) {
    if ((doc.frontmatter.status || "draft") === status) {
      result.add(doc.id);
    }
  }
  return result;
}
function evaluateTransportFilter(transport, docs) {
  const result = /* @__PURE__ */ new Set();
  for (const doc of docs) {
    if (doc.frontmatter.type === "source" && doc.frontmatter.source?.transport === transport) {
      result.add(doc.id);
    }
  }
  return result;
}
function evaluateServerFilter(server, docs) {
  const result = /* @__PURE__ */ new Set();
  for (const doc of docs) {
    if (doc.frontmatter.type === "source" && doc.frontmatter.source?.server === server) {
      result.add(doc.id);
    }
  }
  return result;
}
function intersection(a, b) {
  const result = /* @__PURE__ */ new Set();
  for (const item of a) {
    if (b.has(item)) result.add(item);
  }
  return result;
}
function union(a, b) {
  return /* @__PURE__ */ new Set([...a, ...b]);
}
function difference(a, b) {
  const result = /* @__PURE__ */ new Set();
  for (const item of a) {
    if (!b.has(item)) result.add(item);
  }
  return result;
}

// src/packs.ts
var PackLoader = class {
  packs;
  constructor(packs) {
    this.packs = /* @__PURE__ */ new Map();
    for (const pack of packs) {
      this.packs.set(pack.id, pack);
    }
  }
  /** Get a pack by id */
  get(id) {
    return this.packs.get(id);
  }
  /** List all packs */
  list() {
    return [...this.packs.values()];
  }
  /** Check if a pack exists */
  has(id) {
    return this.packs.has(id);
  }
};

// src/checkpoint.ts
function getLatestCheckpoint(history) {
  return history?.checkpoints?.at(-1) ?? null;
}
function getLatestCheckpointNumber(history) {
  return getLatestCheckpoint(history)?.checkpoint ?? 0;
}
async function scanCheckpointDrift(input) {
  const docs = await input.storage.discoverDocuments();
  const entries = [];
  for (const doc of docs) {
    const entry = await scanOneDocument(doc, input);
    entries.push(entry);
  }
  return {
    scanned: entries.length,
    drifted: entries.filter((e) => e.drifted).length,
    stagedCount: entries.filter((e) => e.staged).length,
    skippedCount: entries.filter((e) => e.skippedReason).length,
    entries
  };
}
async function scanOneDocument(liveNode, input) {
  const documentId = liveNode.id;
  if (!liveNode.frontmatter.checksum) {
    return {
      documentId,
      drifted: false,
      skippedReason: "no-stored-checksum"
    };
  }
  const drift = await input.storage.detectDocumentDrift(documentId);
  if (!drift || !drift.drifted) {
    return { documentId, drifted: false };
  }
  const history = await input.storage.readHistory(documentId);
  if (!history || history.versions.length === 0) {
    return {
      documentId,
      drifted: true,
      skippedReason: "no-version-history"
    };
  }
  let approvedRaw;
  try {
    const latest = history.versions[history.versions.length - 1];
    approvedRaw = await new VersionManager(input.storage).reconstructVersion(
      documentId,
      latest.version
    );
  } catch (err) {
    return {
      documentId,
      drifted: true,
      skippedReason: `chain-head-unreachable: ${err.message}`
    };
  }
  const resolved = resolveZoneAndTier(liveNode, input);
  if (!resolved) {
    return {
      documentId,
      drifted: true,
      skippedReason: "unresolved-zone"
    };
  }
  const result = await stageSuggestion({
    storage: input.storage,
    documentId,
    approvedRawContent: approvedRaw,
    proposedRawContent: liveNode.rawContent,
    source: "out-of-band-edit",
    actor: input.actor,
    zone: resolved.zone,
    docTier: resolved.governance,
    note: "detected during checkpoint scan"
  });
  return {
    documentId,
    drifted: true,
    staged: result.meta
  };
}
function resolveZoneAndTier(node, input) {
  const fmZone = node.frontmatter.zone;
  const fmGov = node.frontmatter.governance;
  if (fmZone && fmGov) {
    return { zone: fmZone, governance: fmGov };
  }
  if (input.manifest) {
    const cls = classifyDocument({
      documentPath: `${node.id}.md`,
      frontmatter: node.frontmatter,
      manifest: input.manifest,
      defaultZone: input.defaultZone ?? ""
    });
    if (cls.zone) {
      return {
        zone: cls.zone,
        governance: cls.governance ?? input.defaultGovernance ?? "standard"
      };
    }
  }
  if (input.defaultZone) {
    return {
      zone: fmZone ?? input.defaultZone,
      governance: fmGov ?? input.defaultGovernance ?? "standard"
    };
  }
  return null;
}
var CheckpointManager = class {
  constructor(storage) {
    this.storage = storage;
  }
  storage;
  /**
   * Run the drift scan against this manager's storage. Returns the scan
   * report without creating a checkpoint — caller decides whether to
   * proceed (e.g. abort on drifted entries, surface to Inbox, etc.).
   */
  async scanForDrift(input) {
    return scanCheckpointDrift({ storage: this.storage, ...input });
  }
  /**
   * Create a new checkpoint (§7.1).
   * Called each time a document is published.
   */
  async createCheckpoint(triggeredBy, publishedDocuments, documentHistories) {
    const history = await this.storage.readCheckpointHistory() || {
      checkpoints: []
    };
    const previousCheckpoint = getLatestCheckpoint(history);
    const checkpointNumber = previousCheckpoint ? previousCheckpoint.checkpoint + 1 : 1;
    const at = (/* @__PURE__ */ new Date()).toISOString();
    const documentVersions = {};
    for (const doc of publishedDocuments) {
      documentVersions[doc.id] = doc.frontmatter.version || 1;
    }
    const documentChainHashes = {};
    for (const doc of publishedDocuments) {
      const docHistory = documentHistories.get(doc.id);
      if (docHistory && docHistory.versions.length > 0) {
        const latestEntry = docHistory.versions[docHistory.versions.length - 1];
        documentChainHashes[doc.id] = latestEntry.chain_hash;
      }
    }
    const checkpointHash = computeCheckpointHash(
      previousCheckpoint?.checkpoint_hash ?? null,
      checkpointNumber,
      at,
      triggeredBy,
      documentVersions,
      documentChainHashes
    );
    const checkpoint = {
      checkpoint: checkpointNumber,
      at,
      triggered_by: triggeredBy,
      document_versions: documentVersions,
      document_chain_hashes: documentChainHashes,
      checkpoint_hash: checkpointHash
    };
    history.checkpoints.push(checkpoint);
    await this.storage.writeCheckpointHistory(history);
    return checkpoint;
  }
  /**
   * Load checkpoint history.
   */
  async loadCheckpointHistory() {
    return this.storage.readCheckpointHistory();
  }
  /**
   * Rebuild checkpoint history from per-document history.yaml files (§7.3).
   */
  async rebuildCheckpointHistory() {
    const allHistories = await this.storage.findAllHistories();
    const tuples = [];
    for (const [docId, history2] of allHistories) {
      for (const entry of history2.versions) {
        if (entry.published_at) {
          tuples.push({
            docId,
            version: entry.version,
            publishedAt: entry.published_at,
            chainHash: entry.chain_hash
          });
        }
      }
    }
    tuples.sort((a, b) => {
      const timeCompare = a.publishedAt.localeCompare(b.publishedAt);
      if (timeCompare !== 0) return timeCompare;
      const pathCompare = a.docId.localeCompare(b.docId);
      if (pathCompare !== 0) return pathCompare;
      return a.version - b.version;
    });
    const runningVersions = {};
    const runningChainHashes = {};
    const checkpoints = [];
    let previousHash = null;
    for (let i = 0; i < tuples.length; i++) {
      const tuple = tuples[i];
      runningVersions[tuple.docId] = tuple.version;
      runningChainHashes[tuple.docId] = tuple.chainHash;
      const checkpointNumber = i + 1;
      const documentVersions = { ...runningVersions };
      const documentChainHashes = { ...runningChainHashes };
      const checkpointHash = computeCheckpointHash(
        previousHash,
        checkpointNumber,
        tuple.publishedAt,
        tuple.docId,
        documentVersions,
        documentChainHashes
      );
      checkpoints.push({
        checkpoint: checkpointNumber,
        at: tuple.publishedAt,
        triggered_by: tuple.docId,
        document_versions: documentVersions,
        document_chain_hashes: documentChainHashes,
        checkpoint_hash: checkpointHash
      });
      previousHash = checkpointHash;
    }
    const history = { checkpoints };
    await this.storage.writeCheckpointHistory(history);
    return history;
  }
};

// src/hygienist.ts
async function runHygienistScan(input) {
  const docs = await input.storage.discoverDocuments();
  const entries = [];
  for (const doc of docs) {
    entries.push(await scanOne(doc, input));
  }
  return {
    scanned: entries.length,
    drifted: entries.filter((e) => e.drifted).length,
    stagedCount: entries.filter((e) => e.staged).length,
    skippedCount: entries.filter((e) => e.skippedReason).length,
    permissionFiltered: entries.filter(
      (e) => e.skippedReason === "no-ingest-permission"
    ).length,
    entries
  };
}
async function scanOne(node, input) {
  const documentId = node.id;
  if (!node.frontmatter.checksum) {
    return { documentId, drifted: false, skippedReason: "no-stored-checksum" };
  }
  const resolved = resolveZoneAndTier2(node, input);
  if (!resolved) {
    return { documentId, drifted: false, skippedReason: "unresolved-zone" };
  }
  const canIngest = await input.rbac.canIngest(input.actor, resolved.zone);
  if (!canIngest) {
    return {
      documentId,
      drifted: false,
      skippedReason: "no-ingest-permission"
    };
  }
  const drift = await input.storage.detectDocumentDrift(documentId);
  if (!drift || !drift.drifted) {
    return { documentId, drifted: false };
  }
  if (input.skipDocsWithPendingSuggestions !== false) {
    const existing = await listSuggestions(input.storage, documentId);
    if (existing.some((s) => s.proposed_hash === drift.actualHash)) {
      return {
        documentId,
        drifted: true,
        skippedReason: "already-staged"
      };
    }
  }
  const history = await input.storage.readHistory(documentId);
  if (!history || history.versions.length === 0) {
    return {
      documentId,
      drifted: true,
      skippedReason: "no-version-history"
    };
  }
  let approvedRaw;
  try {
    const latest = history.versions[history.versions.length - 1];
    approvedRaw = await new VersionManager(input.storage).reconstructVersion(
      documentId,
      latest.version
    );
  } catch (err) {
    return {
      documentId,
      drifted: true,
      skippedReason: `chain-head-unreachable: ${err.message}`
    };
  }
  const result = await stageSuggestion({
    storage: input.storage,
    documentId,
    approvedRawContent: approvedRaw,
    proposedRawContent: node.rawContent,
    source: "out-of-band-edit",
    actor: input.actor,
    zone: resolved.zone,
    docTier: resolved.governance,
    note: "detected by hygienist scan"
  });
  return { documentId, drifted: true, staged: result.meta };
}
function resolveZoneAndTier2(node, input) {
  const fmZone = node.frontmatter.zone;
  const fmGov = node.frontmatter.governance;
  if (fmZone && fmGov) {
    return { zone: fmZone, governance: fmGov };
  }
  if (input.manifest) {
    const cls = classifyDocument({
      documentPath: `${node.id}.md`,
      frontmatter: node.frontmatter,
      manifest: input.manifest,
      defaultZone: input.defaultZone ?? ""
    });
    if (cls.zone) {
      return {
        zone: cls.zone,
        governance: cls.governance ?? input.defaultGovernance ?? "standard"
      };
    }
  }
  if (input.defaultZone) {
    return {
      zone: fmZone ?? input.defaultZone,
      governance: fmGov ?? input.defaultGovernance ?? "standard"
    };
  }
  return null;
}

// src/publish.ts
async function publishDocument(storage, docId, options) {
  let node = await storage.readDocument(docId);
  const versionManager = new VersionManager(storage);
  const existingHistory = await storage.readHistory(docId);
  if (!existingHistory && (node.frontmatter.version || 0) > 1) {
    await versionManager.createVersion(node, "system:seed", {
      note: "Pre-publish snapshot (auto-seeded \u2014 no prior history)"
    });
  }
  const currentVersion = node.frontmatter.version || 0;
  const newVersion = currentVersion + 1;
  node.frontmatter.version = newVersion;
  node.frontmatter.status = "published";
  node.frontmatter.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  const serialized = serializeDocument(node);
  node.frontmatter.checksum = computeContentHash(getChecksumContent(serialized));
  const finalContent = serializeDocument(node);
  node.rawContent = finalContent;
  node.body = finalContent.slice(
    finalContent.indexOf("---", finalContent.indexOf("---") + 3) + 3
  );
  await storage.writeDocument(docId, finalContent);
  node = await storage.readDocument(docId);
  const publishedAt = (/* @__PURE__ */ new Date()).toISOString();
  const versionEntry = await versionManager.createVersion(node, options.editedBy, {
    note: options.note,
    publishedAt
  });
  const allDocs = await storage.discoverDocuments();
  const publishedDocs = allDocs.filter(isPublished);
  const histories = await storage.findAllHistories();
  const checkpointManager = new CheckpointManager(storage);
  const checkpoint = await checkpointManager.createCheckpoint(
    docId,
    publishedDocs,
    histories
  );
  return {
    node,
    versionEntry,
    checkpointNumber: checkpoint.checkpoint
  };
}

// src/source-graph.ts
import toposort from "toposort";
function buildDependencyGraph(sourceNodes) {
  const graph = /* @__PURE__ */ new Map();
  for (const node of sourceNodes) {
    const deps = [];
    if (node.frontmatter.source?.depends_on) {
      for (const dep of node.frontmatter.source.depends_on) {
        const target = dep.replace("contextnest://", "");
        deps.push(target);
      }
    }
    graph.set(node.id, deps);
  }
  return graph;
}
function topologicalSortSources(sourceNodes) {
  const graph = buildDependencyGraph(sourceNodes);
  const edges = [];
  const allIds = /* @__PURE__ */ new Set();
  for (const [nodeId, deps] of graph) {
    allIds.add(nodeId);
    for (const dep of deps) {
      allIds.add(dep);
      edges.push([dep, nodeId]);
    }
  }
  try {
    const sorted = toposort.array([...allIds], edges);
    const sourceIds = new Set(sourceNodes.map((n) => n.id));
    return sorted.filter((id) => sourceIds.has(id));
  } catch (err) {
    if (err instanceof Error && err.message.includes("cycle")) {
      const cycle = detectCycles(sourceNodes);
      throw new CircularDependencyError(cycle || ["unknown"]);
    }
    throw err;
  }
}
function orderSourceNodesTopologically(sources) {
  if (sources.length === 0) return [];
  const sortedIds = topologicalSortSources(sources);
  const sourceMap = new Map(sources.map((n) => [n.id, n]));
  return sortedIds.map((id) => sourceMap.get(id)).filter((n) => n !== void 0);
}
function detectCycles(sourceNodes) {
  const graph = buildDependencyGraph(sourceNodes);
  const visited = /* @__PURE__ */ new Set();
  const inStack = /* @__PURE__ */ new Set();
  const path = [];
  function dfs(nodeId) {
    if (inStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      return [...path.slice(cycleStart), nodeId];
    }
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);
    const deps = graph.get(nodeId) || [];
    for (const dep of deps) {
      const cycle = dfs(dep);
      if (cycle) return cycle;
    }
    path.pop();
    inStack.delete(nodeId);
    return null;
  }
  for (const nodeId of graph.keys()) {
    const cycle = dfs(nodeId);
    if (cycle) return cycle;
  }
  return null;
}

// src/tracing.ts
var DEFAULT_MAX_TRACES = 1e3;
var TraceLogger = class {
  traces = [];
  maxTraces;
  constructor(maxTraces = DEFAULT_MAX_TRACES) {
    this.maxTraces = maxTraces;
  }
  /** Evict oldest entries when buffer is full */
  evictIfNeeded() {
    if (this.traces.length > this.maxTraces) {
      this.traces = this.traces.slice(-this.maxTraces);
    }
  }
  /** Log a document access event (§9.2) */
  logAccess(params) {
    const trace = {
      trace_type: "access",
      document_ref: params.documentRef,
      document_version: params.documentVersion,
      checkpoint: params.checkpoint,
      author: params.author,
      edited_at: params.editedAt,
      accessed_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.traces.push(trace);
    this.evictIfNeeded();
    return trace;
  }
  /** Log a source hydration event (§9.3) */
  logSourceHydration(params) {
    let traceType;
    if (params.error) {
      traceType = "source_failure";
    } else if (params.cacheHit) {
      traceType = "source_cache_hit";
    } else {
      traceType = "source_hydration";
    }
    const trace = {
      trace_type: traceType,
      source_ref: params.sourceRef,
      source_version: params.sourceVersion,
      checkpoint: params.checkpoint,
      tools_called: params.toolsCalled,
      server: params.server,
      result_hash: params.resultHash,
      result_size: params.resultSize,
      cache_hit: params.cacheHit,
      duration_ms: params.durationMs,
      error: params.error
    };
    this.traces.push(trace);
    this.evictIfNeeded();
    return trace;
  }
  /** Get all trace entries */
  getTraces() {
    return [...this.traces];
  }
  /** Clear all traces */
  clear() {
    this.traces = [];
  }
};

// src/injection.ts
var ContextInjector = class {
  resolver;
  packLoader;
  traceLogger;
  currentCheckpoint;
  constructor(options) {
    this.resolver = options.resolver;
    this.packLoader = options.packLoader;
    this.traceLogger = new TraceLogger();
    this.currentCheckpoint = options.currentCheckpoint;
  }
  /**
   * Inject context for a selector query.
   * Returns resolved documents with source nodes ordered topologically.
   */
  async inject(selector) {
    const ast = parseSelector(selector);
    const matchedDocs = await evaluate(ast, {
      resolver: this.resolver,
      packLoader: (id) => this.packLoader.get(id)
    });
    const regularDocs = [];
    const sourceNodes = [];
    for (const doc of matchedDocs) {
      if (doc.frontmatter.type === "source") {
        sourceNodes.push(doc);
      } else {
        regularDocs.push(doc);
      }
    }
    const orderedSourceNodes = orderSourceNodesTopologically(sourceNodes);
    for (const doc of [...regularDocs, ...orderedSourceNodes]) {
      this.traceLogger.logAccess({
        documentRef: `contextnest://${doc.id}`,
        documentVersion: doc.frontmatter.version || 1,
        checkpoint: this.currentCheckpoint,
        author: doc.frontmatter.author,
        editedAt: doc.frontmatter.updated_at
      });
    }
    return {
      documents: regularDocs,
      sourceNodes: orderedSourceNodes,
      traces: this.traceLogger.getTraces()
    };
  }
  /** Get the trace logger for external hydration trace logging */
  getTraceLogger() {
    return this.traceLogger;
  }
};

// src/graph-traverser.ts
var GraphTraverser = class {
  /** Forward adjacency: nodeId → outbound edges */
  forward = /* @__PURE__ */ new Map();
  /** Reverse adjacency: nodeId → inbound edges */
  reverse = /* @__PURE__ */ new Map();
  /** Set of hub node IDs (edges TO these are free) */
  hubIds;
  /** All known node IDs from context.yaml */
  allNodeIds;
  constructor(documents, relationships, hubs) {
    this.allNodeIds = new Set(documents.map((d) => d.id));
    this.hubIds = new Set(hubs.map((h) => h.id));
    for (const edge of relationships) {
      if (!this.forward.has(edge.from)) {
        this.forward.set(edge.from, []);
      }
      this.forward.get(edge.from).push(edge);
      if (!this.reverse.has(edge.to)) {
        this.reverse.set(edge.to, []);
      }
      this.reverse.get(edge.to).push(edge);
    }
  }
  /**
   * Traverse the graph from seed nodes using BFS with hop-cost accounting.
   * Supports adaptive expansion: if fewer than minResults nodes are reached,
   * retries with +1 hops up to maxAdaptiveHops.
   */
  traverse(seedIds, options) {
    const { maxHops, minResults = 1, maxAdaptiveHops = 5 } = options;
    let currentMaxHops = maxHops;
    let result;
    do {
      result = this.bfs(seedIds, currentMaxHops);
      if (result.nodeIds.size >= minResults || currentMaxHops >= maxAdaptiveHops) {
        break;
      }
      currentMaxHops++;
      result = { ...result, hopsUsed: currentMaxHops };
    } while (currentMaxHops <= maxAdaptiveHops);
    return result;
  }
  bfs(seedIds, maxHops) {
    const visited = /* @__PURE__ */ new Set();
    const queue = [];
    let edgesTraversed = 0;
    let actualMaxHop = 0;
    for (const id of seedIds) {
      if (this.allNodeIds.has(id)) {
        visited.add(id);
        queue.push({ nodeId: id, remainingHops: maxHops });
      }
    }
    let head = 0;
    while (head < queue.length) {
      const { nodeId, remainingHops } = queue[head++];
      const hopDepth = maxHops - remainingHops;
      if (hopDepth > actualMaxHop) actualMaxHop = hopDepth;
      const outbound = this.forward.get(nodeId) || [];
      const inbound = this.reverse.get(nodeId) || [];
      for (const edge of outbound) {
        const neighbor = edge.to;
        if (visited.has(neighbor)) continue;
        const cost = this.edgeCost(edge);
        const newRemaining = remainingHops - cost;
        if (newRemaining >= 0) {
          visited.add(neighbor);
          queue.push({ nodeId: neighbor, remainingHops: newRemaining });
          edgesTraversed++;
        }
      }
      for (const edge of inbound) {
        const neighbor = edge.from;
        if (visited.has(neighbor)) continue;
        const cost = this.edgeCost(edge);
        const newRemaining = remainingHops - cost;
        if (newRemaining >= 0) {
          visited.add(neighbor);
          queue.push({ nodeId: neighbor, remainingHops: newRemaining });
          edgesTraversed++;
        }
      }
    }
    return {
      nodeIds: visited,
      hopsUsed: actualMaxHop,
      edgesTraversed
    };
  }
  /**
   * Compute the hop cost for traversing an edge.
   * - depends_on: always free (cost 0)
   * - Edges TO a hub node: free (cost 0)
   * - Explicit priority 0: free
   * - reference edges: cost 1 (or explicit priority)
   */
  edgeCost(edge) {
    if (edge.priority !== void 0) return edge.priority;
    if (edge.type === "depends_on") return 0;
    if (this.hubIds.has(edge.to)) return 0;
    return 1;
  }
};

// src/selector/index-evaluator.ts
import MiniSearch2 from "minisearch";
async function evaluateFromIndex(node, documents, options = {}) {
  return evaluateNode2(node, documents, options);
}
async function evaluateNode2(node, docs, options) {
  switch (node.type) {
    case "tag":
      return evaluateTag2(node.value, docs);
    case "uri":
      return evaluateUri2(node.value, docs);
    case "pack":
      return evaluatePack2(node.value, docs, options);
    case "typeFilter":
      return evaluateTypeFilter2(node.value, docs);
    case "statusFilter":
      return evaluateStatusFilter2(node.value, docs);
    case "transportFilter":
      return evaluateTransportFilter2(node.value, docs);
    case "serverFilter":
      return evaluateServerFilter2(node.value, docs);
    case "and": {
      const left = await evaluateNode2(node.left, docs, options);
      const right = await evaluateNode2(node.right, docs, options);
      return intersection2(left, right);
    }
    case "or": {
      const left = await evaluateNode2(node.left, docs, options);
      const right = await evaluateNode2(node.right, docs, options);
      return union2(left, right);
    }
    case "not": {
      const left = await evaluateNode2(node.left, docs, options);
      const right = await evaluateNode2(node.right, docs, options);
      return difference2(left, right);
    }
  }
}
function evaluateTag2(tag, docs) {
  const result = /* @__PURE__ */ new Set();
  for (const doc of docs) {
    if (doc.tags.includes(tag)) {
      result.add(doc.id);
    }
  }
  return result;
}
function evaluateUri2(uri, docs) {
  const parsed = parseUri(uri);
  const result = /* @__PURE__ */ new Set();
  switch (parsed.kind) {
    case "document": {
      const match = docs.find((d) => d.id === parsed.path);
      if (match && match.status === "published") {
        result.add(match.id);
      }
      break;
    }
    case "tag": {
      const tagName = parsed.path.slice(4);
      for (const doc of docs) {
        if (doc.tags.includes(tagName) && doc.status === "published") {
          result.add(doc.id);
        }
      }
      break;
    }
    case "folder": {
      const prefix = parsed.path + "/";
      for (const doc of docs) {
        if ((doc.id.startsWith(prefix) || doc.id.startsWith(parsed.path)) && doc.status === "published") {
          result.add(doc.id);
        }
      }
      break;
    }
    case "search": {
      const query = parsed.path.slice(7).replace(/\+/g, " ");
      const searchIndex = buildLightweightSearch(docs);
      const results = searchIndex.search(query);
      for (const r of results) {
        result.add(r.id);
      }
      break;
    }
  }
  return result;
}
function buildLightweightSearch(docs) {
  const index = new MiniSearch2({
    fields: ["title", "description", "tags"],
    storeFields: ["id"],
    idField: "id"
  });
  const searchDocs = docs.filter((d) => d.status === "published").map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description || "",
    tags: d.tags.join(" ")
  }));
  index.addAll(searchDocs);
  return index;
}
async function evaluatePack2(packId, docs, options) {
  if (!options.packLoader) return /* @__PURE__ */ new Set();
  const pack = options.packLoader(packId);
  if (!pack) return /* @__PURE__ */ new Set();
  let result = /* @__PURE__ */ new Set();
  if (pack.query) {
    const { parseSelector: parseSelector2 } = await import("./parser-ZUZNXYQ4.js");
    const ast = parseSelector2(pack.query);
    result = await evaluateNode2(ast, docs, options);
  }
  if (pack.includes) {
    for (const uri of pack.includes) {
      const ids = evaluateUri2(uri, docs);
      for (const id of ids) {
        result.add(id);
      }
    }
  }
  if (pack.excludes) {
    for (const uri of pack.excludes) {
      const ids = evaluateUri2(uri, docs);
      for (const id of ids) {
        result.delete(id);
      }
    }
  }
  if (pack.filters?.node_types) {
    const allowedTypes = new Set(pack.filters.node_types);
    const docMap = new Map(docs.map((d) => [d.id, d]));
    for (const id of result) {
      const doc = docMap.get(id);
      if (doc && !allowedTypes.has(doc.type)) {
        result.delete(id);
      }
    }
  }
  return result;
}
function evaluateTypeFilter2(type, docs) {
  const result = /* @__PURE__ */ new Set();
  for (const doc of docs) {
    if (doc.type === type) result.add(doc.id);
  }
  return result;
}
function evaluateStatusFilter2(status, docs) {
  const result = /* @__PURE__ */ new Set();
  for (const doc of docs) {
    if (doc.status === status) result.add(doc.id);
  }
  return result;
}
function evaluateTransportFilter2(transport, docs) {
  const result = /* @__PURE__ */ new Set();
  for (const doc of docs) {
    if (doc.source?.transport === transport) result.add(doc.id);
  }
  return result;
}
function evaluateServerFilter2(server, docs) {
  const result = /* @__PURE__ */ new Set();
  for (const doc of docs) {
    if (doc.source?.server === server) result.add(doc.id);
  }
  return result;
}
function intersection2(a, b) {
  const result = /* @__PURE__ */ new Set();
  for (const item of a) {
    if (b.has(item)) result.add(item);
  }
  return result;
}
function union2(a, b) {
  return /* @__PURE__ */ new Set([...a, ...b]);
}
function difference2(a, b) {
  const result = /* @__PURE__ */ new Set();
  for (const item of a) {
    if (!b.has(item)) result.add(item);
  }
  return result;
}

// src/graph-query-engine.ts
var GraphQueryEngine = class {
  constructor(storage) {
    this.storage = storage;
  }
  storage;
  /**
   * Query the vault using graph traversal.
   *
   * 1. Load context.yaml (lightweight graph index)
   * 2. Evaluate selector against metadata-only docs → seed IDs
   * 3. Traverse edges from seeds for N hops → expanded node set
   * 4. Batch-load bodies only for reached nodes
   */
  async query(selector, options = {}) {
    const { hops = 2, full = false } = options;
    if (!full) {
      let contextYaml = await this.storage.readContextYaml();
      if (!contextYaml) {
        console.error("[ctx] No context.yaml found. Auto-indexing vault...");
        contextYaml = await this.autoIndex();
      }
      if (contextYaml) {
        return this.graphQuery(selector, contextYaml, hops, options);
      }
    }
    return this.fullQuery(selector);
  }
  async graphQuery(selector, contextYaml, maxHops, options) {
    const traceLogger = new TraceLogger();
    const packs = await this.storage.readPacks();
    const packLoader = new PackLoader(packs);
    const ast = parseSelector(selector);
    const seedIds = await evaluateFromIndex(ast, contextYaml.documents, {
      packLoader: (id) => packLoader.get(id)
    });
    const traverser = new GraphTraverser(
      contextYaml.documents,
      contextYaml.relationships,
      contextYaml.hubs
    );
    const traversal = traverser.traverse(seedIds, {
      maxHops,
      minResults: 1,
      maxAdaptiveHops: 5
    });
    const reachedIds = [...traversal.nodeIds];
    const docMap = await this.storage.readDocuments(reachedIds);
    const regularDocs = [];
    const sourceNodes = [];
    for (const doc of docMap.values()) {
      if (!options.includeDrafts && !isPublished(doc)) {
        continue;
      }
      if (doc.frontmatter.type === "source") {
        sourceNodes.push(doc);
      } else {
        regularDocs.push(doc);
      }
    }
    const orderedSourceNodes = orderSourceNodesTopologically(sourceNodes);
    const checkpointHistory = await this.storage.readCheckpointHistory();
    const currentCheckpoint = getLatestCheckpointNumber(checkpointHistory);
    for (const doc of [...regularDocs, ...orderedSourceNodes]) {
      traceLogger.logAccess({
        documentRef: `contextnest://${doc.id}`,
        documentVersion: doc.frontmatter.version || 1,
        checkpoint: currentCheckpoint,
        author: doc.frontmatter.author,
        editedAt: doc.frontmatter.updated_at
      });
    }
    return {
      documents: regularDocs,
      sourceNodes: orderedSourceNodes,
      traces: traceLogger.getTraces(),
      hopsUsed: traversal.hopsUsed,
      nodesTraversed: traversal.nodeIds.size,
      mode: "graph"
    };
  }
  /**
   * Auto-generate context.yaml when it's missing.
   * This makes upgrades seamless — first query triggers indexing.
   */
  async autoIndex() {
    try {
      const docs = await this.storage.discoverDocuments();
      const config = await this.storage.readConfig();
      const checkpointHistory = await this.storage.readCheckpointHistory();
      const latestCheckpoint = getLatestCheckpoint(checkpointHistory);
      const published = docs.filter(isPublished);
      const contextYaml = generateContextYaml(published, config, latestCheckpoint);
      await this.storage.writeContextYaml(contextYaml);
      console.error("[ctx] Auto-index complete. context.yaml generated.");
      return contextYaml;
    } catch {
      console.error("[ctx] Auto-index failed. Falling back to full mode.");
      return null;
    }
  }
  /** Fallback: full-load mode (existing behavior) */
  async fullQuery(selector) {
    const docs = await this.storage.discoverDocuments();
    const packs = await this.storage.readPacks();
    const checkpointHistory = await this.storage.readCheckpointHistory();
    const currentCheckpoint = getLatestCheckpointNumber(checkpointHistory);
    const resolver = new Resolver({ documents: docs });
    const packLoader = new PackLoader(packs);
    const injector = new ContextInjector({
      resolver,
      packLoader,
      currentCheckpoint
    });
    const result = await injector.inject(selector);
    return {
      ...result,
      hopsUsed: 0,
      nodesTraversed: docs.length,
      mode: "full"
    };
  }
};

// src/chain-log.ts
var ChainEventLog = class {
  constructor(storage) {
    this.storage = storage;
  }
  storage;
  /**
   * Append a single event. Schema-validated before write — throws on
   * malformed payloads to prevent audit record poisoning.
   */
  async append(event) {
    const validated = hashChainEventSchema.parse(event);
    await this.storage.appendChainEvent(validated);
  }
  /**
   * Append a batch in order (linked transactional batch —
   * zone-classification-rbac-spec §3.5, Story 4.3). All events are
   * validated up-front; partial writes are not possible because we read
   * the existing log once and write the full result back.
   */
  async appendBatch(events) {
    const validated = events.map((e) => hashChainEventSchema.parse(e));
    for (const event of validated) {
      await this.storage.appendChainEvent(event);
    }
  }
  /** Read every event, validated. Malformed historical entries are dropped silently. */
  async readAll() {
    const raw = await this.storage.readChainEventLog();
    const events = [];
    for (const entry of raw) {
      const r = hashChainEventSchema.safeParse(entry);
      if (r.success) events.push(r.data);
    }
    return events;
  }
  /** Filter events touching a specific document. */
  async readByDocument(documentId) {
    return (await this.readAll()).filter((e) => e.document_id === documentId);
  }
  /** Filter events scoped to a specific zone. */
  async readByZone(zoneId) {
    return (await this.readAll()).filter((e) => e.zone === zoneId);
  }
  /** Filter events of one or more types. */
  async readByType(types) {
    const set = new Set(types);
    return (await this.readAll()).filter((e) => set.has(e.event_type));
  }
};
export {
  CHECKSUM_PATTERN,
  ChainBreakError,
  ChainEventLog,
  CheckpointManager,
  CircularDependencyError,
  ConfigError,
  ContextInjector,
  ContextNestError,
  DocumentNotFoundError,
  FederationNotSupportedError,
  FsStorageProvider,
  GOVERNANCE_TIERS,
  GraphQueryEngine,
  GraphTraverser,
  HASH_CHAIN_EVENT_TYPES,
  IntegrityError,
  InvalidUriError,
  NODE_TYPES,
  NestStorage,
  PackLoader,
  QuarantineError,
  Resolver,
  STATUSES,
  SUGGESTION_SOURCES,
  TAG_PATTERN,
  TRANSPORTS,
  TraceLogger,
  UNSTAGED_DRIFT_SENTINEL,
  UnauthorizedActionError,
  ValidationFailedError,
  VersionManager,
  ZONE_ID_PATTERN,
  ZoneChallengeError,
  approveSuggestion,
  buildBacklinks,
  buildDependencyGraph,
  buildRelationships,
  canonicalJson,
  canonicalizeUri,
  checkpointHistorySchema,
  checkpointSchema,
  classificationManifestSchema,
  classifyDocument,
  computeChainHash,
  computeCheckpointHash,
  computeContentHash,
  countTasks,
  createStorageProvider,
  czarDirectEdit,
  denyAllRbac,
  detectCycles,
  detectDrift,
  detectZoneChallenge,
  documentHistorySchema,
  evaluate,
  evaluateFromIndex,
  extractContextLinks,
  extractManifestFromClaudeMd,
  extractMentions,
  extractPath,
  extractSection,
  extractTags,
  filterIngestibleZones,
  frontmatterSchema,
  generateAgentConfigs,
  generateContextYaml,
  generateIndexMd,
  getChecksumContent,
  getLatestCheckpoint,
  getLatestCheckpointNumber,
  hashChainEventSchema,
  listSuggestions,
  mergeAgentConfig,
  nestConfigSchema,
  normalizeForHash,
  normalizeTags,
  packSchema,
  parseClassificationManifest,
  parseConfig,
  parseDocument,
  parseSelector,
  parseSyntaxConfig,
  parseUri,
  publishDocument,
  quarantineSuggestion,
  readSuggestion,
  rejectSuggestion,
  requireCzar,
  requireDocOwner,
  requireIngest,
  rollbackDocument,
  runHygienistScan,
  scanCheckpointDrift,
  serializeDocument,
  serializeUri,
  sha256,
  stageSuggestion,
  stripTagPrefix,
  suggestionMetaSchema,
  tokenize,
  topologicalSortSources,
  validateDocument,
  verifyCheckpointChain,
  verifyDocumentChain,
  verifyRemoteDelta,
  versionEntrySchema
};
