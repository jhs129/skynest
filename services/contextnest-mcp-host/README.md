# Context Nest MCP Host (Service 1)

Hosted, multi-user Context Nest MCP server for Vercel. See the top-level
[`skynest-plan.md`](../../skynest-plan.md) for the full design.

## Builds on top of a fork of Context Nest

This service does **not** reimplement Context Nest. It vendors a fork of
[`PromptOwl/ContextNest`](https://github.com/PromptOwl/ContextNest) and reuses
its engine/tool logic, swapping only the storage layer so it runs on Vercel
(which has no persistent local filesystem).

```
services/contextnest-mcp-host/
  vendor/contextnest/        # git submodule -> jhs129/ContextNest (fork)
  src/                       # Next.js app: /api/mcp, OAuth, Blob storage wiring
```

The fork's engine centralizes I/O in `NestStorage`. We refactor that into a
**Storage Factory / Provider** abstraction so the backend is pluggable:

- `FsStorageProvider` — original local filesystem (upstream parity, dev, tests)
- `BlobStorageProvider` — **Vercel Blob**, the production backend on Vercel

The factory selects the provider via `CONTEXTNEST_STORAGE` (`blob` on Vercel,
`fs` locally). Version history + per-user attribution come from the GitHub REST
API committing to `jhs129/contextnest-vault`.

## Setup

The fork and submodule are created by a script at the repo root (requires the
`gh` CLI authenticated, `git`, `pnpm`, and network access to github.com):

```bash
scripts/setup-fork.sh
```

This forks `PromptOwl/ContextNest` → `jhs129/ContextNest`, attaches it as the
submodule above, adds an `upstream` remote, and builds the vendored engine.

> Note: the fork could not be created automatically in the environment where
> this branch was authored (its GitHub access was scoped to `jhs129/skynest`
> only). Run the script from an environment with broader GitHub scope, or fork
> manually and then run the script to wire up the submodule.

## License

The upstream engine/CLI/MCP packages are **AGPL-3.0**; the spec is Apache-2.0.
Hosting the fork means our modifications must be made available under AGPL, or
covered by a commercial license from PromptOwl. See `skynest-plan.md` open items.
