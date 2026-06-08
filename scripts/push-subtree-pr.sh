#!/usr/bin/env bash
# Push a subtree contribution branch to its upstream remote and open a PR.
#
# Usage:
#   ./scripts/push-subtree-pr.sh [branch] [remote] [base]
#
# Defaults:
#   branch  contextnest-contribution
#   remote  contextnest
#   base    main
#
# The script:
#   1. Verifies the branch exists locally
#   2. Pushes it to <remote>/<branch>
#   3. Opens an interactive gh pr create pointing at the upstream repo

set -euo pipefail

BRANCH="${1:-contextnest-contribution}"
REMOTE="${2:-contextnest}"
BASE="${3:-main}"

# Resolve the upstream GitHub repo from the remote URL
REMOTE_URL=$(git remote get-url "$REMOTE" 2>/dev/null) || {
  echo "Error: remote '$REMOTE' not found. Available remotes:" >&2
  git remote -v >&2
  exit 1
}

# Normalise SSH and HTTPS URLs → owner/repo
REPO=$(echo "$REMOTE_URL" \
  | sed 's|git@github.com:||; s|https://github.com/||; s|\.git$||')

echo "==> Pushing '$BRANCH' to $REMOTE ($REPO)..."
git push "$REMOTE" "$BRANCH:$BRANCH"

echo ""
echo "==> Opening PR on $REPO (base: $BASE)..."
gh pr create \
  --repo "$REPO" \
  --base "$BASE" \
  --head "$BRANCH" \
  --fill
