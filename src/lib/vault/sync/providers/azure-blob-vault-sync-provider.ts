import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { VaultSyncProvider } from '../vault-sync-provider.js';

export interface AzureBlobVaultSyncConfig {
  containerName: string;
  vaultId: string;
  connectionString?: string;
  accountUrl?: string;
}

function createBlobServiceClient(config: AzureBlobVaultSyncConfig): BlobServiceClient {
  if (config.connectionString) {
    return BlobServiceClient.fromConnectionString(config.connectionString);
  }
  if (!config.accountUrl) {
    throw new Error(
      'Azure vault sync requires an account URL (managed identity) or a connection string'
    );
  }
  return new BlobServiceClient(config.accountUrl, new DefaultAzureCredential());
}

// Blob metadata values must be ASCII, so free-form text (commit messages, usernames)
// is base64-encoded going in and decoded by anything reading the audit trail back out.
function toAscii(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64');
}

/**
 * Records vault writes as versioned Azure Blob uploads instead of GitHub commits.
 * Requires blob versioning and soft-delete to be enabled on the target container —
 * this class only uploads/deletes; it does not (and cannot) turn those on itself.
 *
 * Attribution here is an app-asserted claim carried in blob metadata, not a
 * cryptographically verified identity the way a GitHub commit under the user's
 * own OAuth token is. That's an accepted tradeoff of Azure-native auth modes
 * where no per-user, write-scoped credential exists.
 */
export class AzureBlobVaultSyncProvider implements VaultSyncProvider {
  private readonly containerClient;

  constructor(private readonly config: AzureBlobVaultSyncConfig) {
    this.containerClient = createBlobServiceClient(config).getContainerClient(config.containerName);
  }

  private blobName(path: string): string {
    return `${this.config.vaultId}/${path}`;
  }

  async commitFile(params: {
    path: string;
    content: Buffer;
    message: string;
    editedBy: string;
  }): Promise<void> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(this.blobName(params.path));
    await blockBlobClient.upload(params.content, params.content.length, {
      metadata: {
        messageB64: toAscii(params.message),
        editedByB64: toAscii(params.editedBy),
        editedAt: new Date().toISOString(),
      },
    });
  }

  async deleteFile(params: {
    path: string;
    message: string;
    editedBy: string;
  }): Promise<void> {
    const blobName = this.blobName(params.path);

    // Write a zero-byte tombstone version first so the delete reason and
    // attribution survive in version history — Azure Blob delete itself has
    // no message field. Soft-delete retention then protects this version
    // (and the last real content version) from being purged immediately.
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.upload(Buffer.alloc(0), 0, {
      metadata: {
        tombstone: 'true',
        messageB64: toAscii(params.message),
        editedByB64: toAscii(params.editedBy),
        editedAt: new Date().toISOString(),
      },
    });

    await this.containerClient.getBlobClient(blobName).deleteIfExists();
  }
}
