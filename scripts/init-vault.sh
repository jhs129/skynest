#!/usr/bin/env bash
# init-vault.sh — Push a local Context Nest vault directory to a remote git repo.
#
# Usage:
#   scripts/init-vault.sh <local-vault-path> <remote-url>
#   VAULT_REPO_URL=https://github.com/owner/repo.git scripts/init-vault.sh <local-vault-path>
#
# Requirements: git, network access. Safe to re-run (each step is guarded).

set -euo pipefail

VAULT_PATH="${1:?Usage: init-vault.sh <local-vault-path> [remote-url]}"
REMOTE_URL="${2:-${VAULT_REPO_URL:?Provide remote URL as \$2 or VAULT_REPO_URL env var}}"

echo "==> Vault path: ${VAULT_PATH}"
echo "==> Remote URL: ${REMOTE_URL}"

cd "${VAULT_PATH}"

echo "==> 1/3 Initializing git repo (if needed)"
if [ ! -d ".git" ]; then
  git init
  git add -A
  git commit -m "chore: initial vault commit"
  echo "    Initialized."
else
  echo "    Already a git repo, skipping init."
fi

echo "==> 2/3 Wiring remote origin"
if git remote get-url origin >/dev/null 2>&1; then
  echo "    Remote 'origin' already set: $(git remote get-url origin)"
else
  git remote add origin "${REMOTE_URL}"
  echo "    Added origin."
fi

echo "==> 3/3 Pushing to remote"
git push -u origin HEAD:main

echo
echo "Done. Vault pushed to ${REMOTE_URL}."
echo "Next steps:"
echo "  1. Add team members as collaborators on the Git host."
echo "  2. Link a Vercel Blob store to your Vercel project."
echo "  3. Run: vercel env add VAULT_REPO (set to owner/repo)"
echo "  4. Deploy: vercel deploy"
