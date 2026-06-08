import type { NestStorage } from '@promptowl/contextnest-engine';

export async function isDuplicate(storage: NestStorage, requestId: string): Promise<boolean> {
  const docs = await storage.discoverDocuments();
  return docs.some(
    (node) =>
      node.id.startsWith('meetings/') &&
      node.frontmatter.metadata?.request_id === requestId,
  );
}
