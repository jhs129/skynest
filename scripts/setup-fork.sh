#!/usr/bin/env bash
#
# setup-fork.sh — Fork PromptOwl/ContextNest and wire it into this repo so the
# hosted MCP service (services/contextnest-mcp-host) can build on top of it.
#
# What it does:
#   1. Forks PromptOwl/ContextNest -> jhs129/ContextNest (via the gh CLI).
#   2. Adds the fork as a git submodule at
#      services/contextnest-mcp-host/vendor/contextnest.
#   3. Registers PromptOwl/ContextNest as an `upstream` remote inside the
#      submodule so future releases can be pulled.
#   4. Installs + builds the vendored engine with pnpm.
#
# Requirements: gh (authenticated), git, pnpm, and network access to github.com.
# Re-runnable: each step is guarded so a partial run can be resumed.
#
# Usage:
#   scripts/setup-fork.sh
#   FORK_OWNER=myorg scripts/setup-fork.sh   # fork into a different owner/org

set -euo pipefail

UPSTREAM_OWNER="PromptOwl"
UPSTREAM_REPO="ContextNest"
FORK_OWNER="${FORK_OWNER:-jhs129}"
SUBMODULE_PATH="services/contextnest-mcp-host/vendor/contextnest"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

echo "==> 1/4 Forking ${UPSTREAM_OWNER}/${UPSTREAM_REPO} -> ${FORK_OWNER}/${UPSTREAM_REPO}"
if gh repo view "${FORK_OWNER}/${UPSTREAM_REPO}" >/dev/null 2>&1; then
  echo "    Fork ${FORK_OWNER}/${UPSTREAM_REPO} already exists, skipping."
else
  # --clone=false: we attach it as a submodule below rather than a loose clone.
  gh repo fork "${UPSTREAM_OWNER}/${UPSTREAM_REPO}" --clone=false
fi

echo "==> 2/4 Adding submodule at ${SUBMODULE_PATH}"
if [ -f "${SUBMODULE_PATH}/.git" ] || [ -d "${SUBMODULE_PATH}/.git" ]; then
  echo "    Submodule already present, skipping add."
else
  mkdir -p "$(dirname "${SUBMODULE_PATH}")"
  git submodule add "https://github.com/${FORK_OWNER}/${UPSTREAM_REPO}.git" "${SUBMODULE_PATH}"
fi
git submodule update --init --recursive "${SUBMODULE_PATH}"

echo "==> 3/4 Registering 'upstream' remote inside the submodule"
(
  cd "${SUBMODULE_PATH}"
  if git remote get-url upstream >/dev/null 2>&1; then
    echo "    upstream remote already set, skipping."
  else
    git remote add upstream "https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}.git"
  fi
  git fetch upstream --tags || true
)

echo "==> 4/4 Building the vendored engine"
(
  cd "${SUBMODULE_PATH}"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install
    pnpm build
  else
    echo "    pnpm not found — skipping build. Install pnpm (>=9) and run 'pnpm install && pnpm build' in ${SUBMODULE_PATH}." >&2
  fi
)

echo
echo "Done. The fork is vendored at ${SUBMODULE_PATH}."
echo "Next: implement the StorageProvider/Factory refactor on the fork (see"
echo "skynest-plan.md > 'Forking & filesystem strategy') and consume the engine"
echo "from services/contextnest-mcp-host."
