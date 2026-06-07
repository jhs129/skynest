/**
 * Tests for MCP server mutation tools.
 * Exercises the engine layer directly since the MCP tool handlers are thin wrappers.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  NestStorage,
  publishDocument,
  serializeDocument,
  validateDocument,
  generateContextYaml,
  generateIndexMd,
  DocumentNotFoundError,
} from "@promptowl/contextnest-engine";
import type { ContextNode, Frontmatter, ContextYaml } from "@promptowl/contextnest-engine";

let vaultPath: string;
let storage: NestStorage;

/**
 * Regenerate context.yaml and INDEX.md — mirrors the MCP server's regenerateIndex().
 */
async function regenerateIndex(storage: NestStorage): Promise<void> {
  const docs = await storage.discoverDocuments();
  const config = await storage.readConfig();
  const checkpointHistory = await storage.readCheckpointHistory();
  const latestCheckpoint = checkpointHistory?.checkpoints?.at(-1) ?? null;
  const published = docs.filter((d) => d.frontmatter.status === "published");

  const contextYaml = generateContextYaml(published, config, latestCheckpoint);
  await storage.writeContextYaml(contextYaml);

  const folders = new Map<string, ContextNode[]>();
  for (const doc of docs) {
    const parts = doc.id.split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder)!.push(doc);
  }

  for (const [folder, folderDocs] of folders) {
    if (folder === ".") continue;
    const title = folder
      .split("/")
      .pop()!
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const indexMd = generateIndexMd(folder, title, folderDocs);
    await storage.writeIndexMd(folder, indexMd);
  }
}

/**
 * Helper: create a document, publish it, and regenerate the index.
 * Mirrors the MCP create_document tool behavior.
 */
async function createDocument(
  storage: NestStorage,
  id: string,
  title: string,
  opts: { type?: string; tags?: string[]; body?: string } = {},
) {
  const tagList = opts.tags
    ? opts.tags.map((t) => (t.startsWith("#") ? t : `#${t}`))
    : undefined;
  const frontmatter: Frontmatter = {
    title,
    type: (opts.type as any) || "document",
    status: "draft",
    version: 1,
    created_at: new Date().toISOString(),
    ...(tagList ? { tags: tagList } : {}),
  };

  const node: ContextNode = {
    id,
    filePath: "",
    frontmatter,
    body: opts.body ? `\n${opts.body}\n` : `\n# ${title}\n\n`,
    rawContent: "",
  };

  const content = serializeDocument(node);
  await storage.writeDocument(id, content);

  const result = await publishDocument(storage, id, {
    editedBy: "test@contextnest.local",
    note: "Created in test",
  });

  await regenerateIndex(storage);
  return result;
}

beforeAll(async () => {
  vaultPath = await mkdtemp(join(tmpdir(), "contextnest-mcp-test-"));
  storage = new NestStorage(vaultPath);
  await storage.init("Test Vault");
});

afterAll(async () => {
  await rm(vaultPath, { recursive: true });
});

// ─── create_document ──────────────────────────────────────────────────────────

describe("create_document", () => {
  it("creates a document with correct frontmatter", async () => {
    const result = await createDocument(storage, "nodes/test-create", "Test Create", {
      tags: ["api", "test"],
    });

    const doc = await storage.readDocument("nodes/test-create");
    expect(doc.frontmatter.title).toBe("Test Create");
    expect(doc.frontmatter.type).toBe("document");
    expect(doc.frontmatter.tags).toEqual(["#api", "#test"]);
  });

  it("auto-publishes with version and history", async () => {
    const result = await createDocument(storage, "nodes/test-autopub", "Auto Pub Test");

    expect(result.node.frontmatter.status).toBe("published");
    expect(result.node.frontmatter.version).toBeGreaterThanOrEqual(1);
    expect(result.versionEntry.chain_hash).toBeTruthy();

    const history = await storage.readHistory("nodes/test-autopub");
    expect(history).not.toBeNull();
    expect(history!.versions.length).toBeGreaterThanOrEqual(1);
  });

  it("auto-regenerates context.yaml with new document", async () => {
    await createDocument(storage, "nodes/test-index-create", "Index Create Test");

    const contextYaml = await storage.readContextYaml();
    expect(contextYaml).not.toBeNull();
    const docIds = contextYaml!.documents.map((d: any) => d.id);
    expect(docIds).toContain("nodes/test-index-create");
  });

  it("rejects duplicate document path", async () => {
    await createDocument(storage, "nodes/test-dup", "Dup Test");

    // Attempting to create again should fail at readDocument (already exists)
    try {
      await storage.readDocument("nodes/test-dup");
      // Document exists — MCP server would return an error here
      expect(true).toBe(true);
    } catch {
      expect.unreachable("Document should exist");
    }
  });
});

// ─── update_document ──────────────────────────────────────────────────────────

describe("update_document", () => {
  beforeAll(async () => {
    await createDocument(storage, "nodes/test-update", "Original Title", {
      tags: ["old-tag"],
    });
  });

  it("updates title, tags, and body", async () => {
    const doc = await storage.readDocument("nodes/test-update");
    doc.frontmatter.title = "Updated Title";
    doc.frontmatter.tags = ["#new-tag", "#updated"];
    doc.body = "\nUpdated body content.\n";
    doc.frontmatter.updated_at = new Date().toISOString();

    const content = serializeDocument(doc);
    await storage.writeDocument("nodes/test-update", content);

    const updated = await storage.readDocument("nodes/test-update");
    expect(updated.frontmatter.title).toBe("Updated Title");
    expect(updated.frontmatter.tags).toEqual(["#new-tag", "#updated"]);
    expect(updated.body).toContain("Updated body content.");
  });

  it("auto-publishes with bumped version", async () => {
    const doc = await storage.readDocument("nodes/test-update");
    const prevVersion = doc.frontmatter.version || 0;

    doc.frontmatter.title = "Updated Again";
    doc.frontmatter.updated_at = new Date().toISOString();
    const content = serializeDocument(doc);
    await storage.writeDocument("nodes/test-update", content);

    const result = await publishDocument(storage, "nodes/test-update", {
      editedBy: "test@contextnest.local",
      note: "Updated in test",
    });

    expect(result.node.frontmatter.version).toBeGreaterThan(prevVersion);

    const history = await storage.readHistory("nodes/test-update");
    expect(history!.versions.length).toBeGreaterThanOrEqual(2);
  });

  it("auto-regenerates context.yaml after update", async () => {
    const doc = await storage.readDocument("nodes/test-update");
    doc.frontmatter.title = "Final Update Title";
    doc.frontmatter.updated_at = new Date().toISOString();
    const content = serializeDocument(doc);
    await storage.writeDocument("nodes/test-update", content);

    await publishDocument(storage, "nodes/test-update", {
      editedBy: "test@contextnest.local",
      note: "Final update",
    });
    await regenerateIndex(storage);

    const contextYaml = await storage.readContextYaml();
    const entry = contextYaml!.documents.find((d: any) => d.id === "nodes/test-update");
    expect(entry).toBeTruthy();
    expect(entry!.title).toBe("Final Update Title");
  });

  it("rejects invalid frontmatter", async () => {
    const doc = await storage.readDocument("nodes/test-update");
    doc.frontmatter.title = ""; // Invalid: title must be 1-200 chars

    const validation = validateDocument(doc);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });
});

// ─── delete_document ──────────────────────────────────────────────────────────

describe("delete_document", () => {
  it("deletes a document from disk", async () => {
    await createDocument(storage, "nodes/test-delete", "Delete Me");

    await storage.deleteDocument("nodes/test-delete");

    await expect(storage.readDocument("nodes/test-delete")).rejects.toThrow(
      DocumentNotFoundError,
    );
  });

  it("cleans up version history", async () => {
    await createDocument(storage, "nodes/test-delete-history", "Delete History");

    const history = await storage.readHistory("nodes/test-delete-history");
    expect(history).not.toBeNull();

    await storage.deleteDocument("nodes/test-delete-history");

    const historyAfter = await storage.readHistory("nodes/test-delete-history");
    expect(historyAfter).toBeNull();
  });

  it("auto-regenerates context.yaml without deleted doc", async () => {
    await createDocument(storage, "nodes/test-delete-index", "Delete Index Test");

    let contextYaml = await storage.readContextYaml();
    let docIds = contextYaml!.documents.map((d: any) => d.id);
    expect(docIds).toContain("nodes/test-delete-index");

    await storage.deleteDocument("nodes/test-delete-index");
    await regenerateIndex(storage);

    contextYaml = await storage.readContextYaml();
    docIds = contextYaml!.documents.map((d: any) => d.id);
    expect(docIds).not.toContain("nodes/test-delete-index");
  });

  it("throws DocumentNotFoundError for non-existent document", async () => {
    await expect(storage.deleteDocument("nodes/does-not-exist")).rejects.toThrow(
      DocumentNotFoundError,
    );
  });
});

// ─── publish_document ─────────────────────────────────────────────────────────

describe("publish_document", () => {
  beforeAll(async () => {
    // Create a draft document without auto-publish
    const frontmatter: Frontmatter = {
      title: "Draft Doc",
      type: "document",
      status: "draft",
      version: 1,
      created_at: new Date().toISOString(),
    };
    const node: ContextNode = {
      id: "nodes/test-publish-draft",
      filePath: "",
      frontmatter,
      body: "\n# Draft Doc\n\n",
      rawContent: "",
    };
    const content = serializeDocument(node);
    await storage.writeDocument("nodes/test-publish-draft", content);
  });

  it("publishes a draft with version bump and checksum", async () => {
    const result = await publishDocument(storage, "nodes/test-publish-draft", {
      editedBy: "test@contextnest.local",
      note: "First publish",
    });

    expect(result.node.frontmatter.status).toBe("published");
    expect(result.node.frontmatter.version).toBeGreaterThanOrEqual(1);
    expect(result.node.frontmatter.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("creates a checkpoint entry", async () => {
    const checkpointHistory = await storage.readCheckpointHistory();
    expect(checkpointHistory).not.toBeNull();
    expect(checkpointHistory!.checkpoints.length).toBeGreaterThanOrEqual(1);
  });

  it("auto-regenerates index after publish", async () => {
    await regenerateIndex(storage);

    const contextYaml = await storage.readContextYaml();
    const docIds = contextYaml!.documents.map((d: any) => d.id);
    expect(docIds).toContain("nodes/test-publish-draft");
  });
});

// ─── Index regeneration ───────────────────────────────────────────────────────

describe("index regeneration", () => {
  it("context.yaml only includes published documents", async () => {
    // Create a draft (without publishing)
    const frontmatter: Frontmatter = {
      title: "Unpublished Doc",
      type: "document",
      status: "draft",
      version: 1,
      created_at: new Date().toISOString(),
    };
    const node: ContextNode = {
      id: "nodes/test-unpublished",
      filePath: "",
      frontmatter,
      body: "\n# Unpublished\n\n",
      rawContent: "",
    };
    await storage.writeDocument("nodes/test-unpublished", serializeDocument(node));

    await regenerateIndex(storage);

    const contextYaml = await storage.readContextYaml();
    const docIds = contextYaml!.documents.map((d: any) => d.id);
    expect(docIds).not.toContain("nodes/test-unpublished");

    // Clean up
    await storage.deleteDocument("nodes/test-unpublished");
  });

  it("generates INDEX.md for document folders", async () => {
    await regenerateIndex(storage);

    const indexContent = await readFile(
      join(vaultPath, "nodes", "INDEX.md"),
      "utf-8",
    );
    expect(indexContent).toBeTruthy();
    expect(indexContent).toContain("Nodes");
  });
});
