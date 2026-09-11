# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Manager

Always use `pnpm` for dependency management.

## Project

This is a greenfield project. Update this file as the stack and architecture take shape.

## Keep the global `skynest` skill in sync with the MCP interface

Every Claude Code session on this machine loads a personal skill at
`~/.claude/skills/skynest/SKILL.md` that documents how to connect to and use this
project's MCP server (tools, selector syntax, and authentication — including the
headless GitHub PAT passthrough and Entra client-credentials paths). It is the only
place that knowledge lives outside this repo's source.

A `PostToolUse` hook (`.claude/hooks/remind-skynest-skill-update.mjs`, registered in
`.claude/settings.json`) fires whenever an Edit/Write touches `src/lib/mcp/**`,
`src/app/api/mcp/**`, `src/app/oauth/**`, or `src/lib/authorization/**`, and reminds
Claude to review/update that skill before finishing the task. If you change a tool's
name, params, or behavior, or change how a client authenticates, update
`~/.claude/skills/skynest/SKILL.md` to match — don't rely solely on the hook firing
(e.g. it won't catch changes made via Bash/sed instead of Edit/Write).
