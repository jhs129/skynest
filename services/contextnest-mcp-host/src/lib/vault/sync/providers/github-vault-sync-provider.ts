import type { GitVaultSyncProvider } from '../git-vault-sync-provider.js';

export interface GitHubVaultSyncProviderConfig {
  repo: string;
  branch: string;
}

/**
 * GitHub-based implementation of GitVaultSyncProvider.
 * Records file changes as commits in a GitHub repository.
 */
export class GitHubVaultSyncProvider implements GitVaultSyncProvider {
  constructor(readonly config: GitHubVaultSyncProviderConfig) {}

  async commitFile(params: {
    path: string;
    content: Buffer;
    message: string;
    userToken: string;
  }): Promise<void> {
    // TODO: Implement GitHub commit logic in Task 6
    console.log(`[GitHubVaultSyncProvider] commitFile: ${params.path}`);
  }

  async deleteFile(params: {
    path: string;
    message: string;
    userToken: string;
  }): Promise<void> {
    // TODO: Implement GitHub delete logic in Task 6
    console.log(`[GitHubVaultSyncProvider] deleteFile: ${params.path}`);
  }
}
