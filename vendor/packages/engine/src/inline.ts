/**
 * Inline syntax extraction from markdown bodies (§1.7).
 * Extracts contextnest:// links, #tags, @mentions, and task checkboxes.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { ContextNode, RelationshipEdge } from "./types.js";

const processor = unified().use(remarkParse).use(remarkGfm);

/** Extract all contextnest:// link targets from a markdown body */
export function extractContextLinks(body: string): string[] {
  const tree = processor.parse(body);
  const links: string[] = [];

  function walk(node: any) {
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

/** Extract all #tag references from a markdown body */
export function extractTags(body: string): string[] {
  const tags = new Set<string>();
  // Match #tag that is not inside a URL or code block
  // Simple approach: match standalone #word patterns
  const pattern = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    tags.add(`#${match[1]}`);
  }
  return [...tags];
}

/** Extract all @mention references from a markdown body */
export function extractMentions(body: string): string[] {
  const mentions = new Set<string>();
  const pattern = /(?:^|\s)@((?:team:)?[a-zA-Z][a-zA-Z0-9._-]*[a-zA-Z0-9])/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    mentions.add(`@${match[1]}`);
  }
  return [...mentions];
}

/** Count task checkboxes in a markdown body */
export function countTasks(body: string): { total: number; completed: number } {
  const incomplete = (body.match(/- \[ \]/g) || []).length;
  const complete = (body.match(/- \[x\]/gi) || []).length;
  return { total: incomplete + complete, completed: complete };
}

/**
 * Build a relationship edge list from all documents.
 * Extracts `reference` edges from contextnest:// links
 * and `depends_on` edges from source node frontmatter.
 */
export function buildRelationships(documents: ContextNode[]): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];

  for (const doc of documents) {
    // Extract reference edges from inline links
    const links = extractContextLinks(doc.body);
    for (const link of links) {
      // Extract path from URI, stripping anchor and checkpoint
      let target = link.replace("contextnest://", "");
      // Remove anchor
      const anchorIdx = target.indexOf("#");
      if (anchorIdx !== -1) target = target.slice(0, anchorIdx);
      // Remove checkpoint pin
      const pinIdx = target.indexOf("@");
      if (pinIdx !== -1) target = target.slice(0, pinIdx);
      // Remove trailing slash
      if (target.endsWith("/")) target = target.slice(0, -1);

      // If it looks like a cross-namespace link (contains authority), keep full URI
      const to = target.includes("://")
        ? link
        : target;

      edges.push({ from: doc.id, to, type: "reference" });
    }

    // Extract depends_on edges from source node frontmatter
    if (doc.frontmatter.source?.depends_on) {
      for (const dep of doc.frontmatter.source.depends_on) {
        const target = dep.replace("contextnest://", "");
        edges.push({ from: doc.id, to: target, type: "depends_on" });
      }
    }
  }

  return edges;
}

/**
 * Build a backlinks map: for each document, which other documents reference it.
 */
export function buildBacklinks(documents: ContextNode[]): Map<string, string[]> {
  const backlinks = new Map<string, string[]>();
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

/**
 * Extract section content by anchor from a markdown body.
 * Returns the content from the matched heading to the next heading of same or higher level.
 */
export function extractSection(body: string, anchor: string): string | null {
  const tree = processor.parse(body) as any;
  let found = false;
  let foundDepth = 0;
  const lines = body.split("\n");
  let startLine = -1;
  let endLine = lines.length;

  for (const node of tree.children) {
    if (node.type === "heading") {
      // Convert heading text to anchor: lowercase, spaces to hyphens, strip non-alphanumeric except hyphens
      const text = getHeadingText(node);
      const headingAnchor = text
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");

      if (found && node.depth <= foundDepth) {
        // Found the end of the section
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

function getHeadingText(node: any): string {
  const parts: string[] = [];
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
