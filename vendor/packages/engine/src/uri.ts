/**
 * contextnest:// URI parsing, canonicalization, and serialization (§4).
 */

import type { ContextNestUri } from "./types.js";
import { InvalidUriError } from "./errors.js";

const URI_PREFIX = "contextnest://";

/**
 * Parse a contextnest:// URI into its components (§4.1).
 */
export function parseUri(raw: string): ContextNestUri {
  if (!raw.startsWith(URI_PREFIX)) {
    throw new InvalidUriError(raw, "URI must start with contextnest://");
  }

  let remainder = raw.slice(URI_PREFIX.length);

  if (!remainder) {
    throw new InvalidUriError(raw, "URI path cannot be empty");
  }

  // Check for consecutive slashes (§4.3)
  if (remainder.includes("//")) {
    throw new InvalidUriError(raw, "Consecutive slashes are not allowed");
  }

  // Check for tag URI: tag/{name}
  if (remainder.startsWith("tag/")) {
    const tagName = remainder.slice(4);
    if (!tagName) {
      throw new InvalidUriError(raw, "Tag name cannot be empty");
    }
    return { path: remainder, kind: "tag" };
  }

  // Check for search URI: search/{query}
  if (remainder.startsWith("search/")) {
    const query = remainder.slice(7);
    if (!query) {
      throw new InvalidUriError(raw, "Search query cannot be empty");
    }
    return { path: remainder, kind: "search" };
  }

  // Check for folder URI (trailing slash)
  if (remainder.endsWith("/")) {
    const folderPath = remainder.slice(0, -1);
    if (!folderPath) {
      throw new InvalidUriError(raw, "Folder path cannot be empty");
    }
    return { path: folderPath, kind: "folder" };
  }

  // Parse anchor
  let anchor: string | undefined;
  const anchorIdx = remainder.indexOf("#");
  if (anchorIdx !== -1) {
    anchor = remainder.slice(anchorIdx + 1);
    if (!anchor) {
      throw new InvalidUriError(raw, "Empty anchor (#) is not allowed (§4.3)");
    }
    remainder = remainder.slice(0, anchorIdx);
  }

  // Parse checkpoint pin @N
  let checkpoint: number | undefined;
  const pinIdx = remainder.indexOf("@");
  if (pinIdx !== -1) {
    const pinStr = remainder.slice(pinIdx + 1);
    remainder = remainder.slice(0, pinIdx);

    if (!/^\d+$/.test(pinStr)) {
      throw new InvalidUriError(raw, "Checkpoint pin must be a non-negative integer");
    }

    // Reject leading zeros (§4.3)
    if (pinStr.length > 1 && pinStr.startsWith("0")) {
      throw new InvalidUriError(raw, "Checkpoint pin must not have leading zeros");
    }

    checkpoint = parseInt(pinStr, 10);

    // @0 is reserved (§4.3)
    if (checkpoint === 0) {
      throw new InvalidUriError(raw, "@0 is reserved and must not be used");
    }
  }

  // Parse namespace (authority component)
  // A URI like contextnest://acme/docs/api-design has namespace "acme"
  // But we need to distinguish from simple paths like contextnest://nodes/api-design
  // The authority is present when there's a namespace declaration in context.yaml
  // For now, we treat all paths as local (no authority) per §4.0 Anonymous URIs
  let namespace: string | undefined;

  // Percent-decode path segments (§4.3)
  try {
    remainder = decodeURIComponent(remainder);
  } catch {
    throw new InvalidUriError(raw, "Invalid percent-encoding in URI");
  }

  // Resolve dot segments (§4.3)
  const segments = remainder.split("/").filter(Boolean);
  const resolved: string[] = [];
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
    kind: "document",
  };
}

/**
 * Canonicalize a ContextNestUri (§4.3).
 */
export function canonicalizeUri(uri: ContextNestUri): string {
  let result = URI_PREFIX;

  // Lowercase authority (§4.3)
  if (uri.namespace) {
    result += uri.namespace.toLowerCase() + "/";
  }

  result += uri.path;

  if (uri.kind === "folder") {
    result += "/";
  }

  if (uri.checkpoint !== undefined) {
    result += `@${uri.checkpoint}`;
  }

  if (uri.anchor) {
    result += `#${uri.anchor}`;
  }

  return result;
}

/**
 * Serialize a ContextNestUri to its canonical string form.
 */
export function serializeUri(uri: ContextNestUri): string {
  return canonicalizeUri(uri);
}

/**
 * Extract the document path from a contextnest:// URI string.
 * Convenience function for resolving links.
 */
export function extractPath(uriStr: string): string {
  const uri = parseUri(uriStr);
  return uri.path;
}
