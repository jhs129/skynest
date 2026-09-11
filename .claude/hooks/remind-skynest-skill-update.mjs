#!/usr/bin/env node
// PostToolUse hook: when an Edit/Write touches a file that defines the Skynest
// MCP interface (tool list, auth/verification logic, resources), remind Claude
// to keep the global `skynest` skill (~/.claude/skills/skynest/SKILL.md) in
// sync. That skill is loaded in every Claude Code session on this machine and
// documents how to connect to / call this server — it has no other way to
// learn about an interface change made here.
//
// Exit code 2 on PostToolUse doesn't block anything (the edit already
// happened) — it just surfaces stderr back to Claude as a reminder to act on.

const INTERFACE_PATH_PATTERNS = [
  /^src\/lib\/mcp\/(?!.*\.test\.ts$).*\.ts$/, // tools.ts, auth.ts, skills.ts, trusted-issuer.ts, typed-blocks.ts
  /^src\/app\/api\/mcp\//,
  /^src\/app\/oauth\//,
  /^src\/lib\/authorization\//,
];

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const filePath = payload?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const cwd = payload.cwd ?? process.cwd();
  const relPath = filePath.startsWith(cwd) ? filePath.slice(cwd.length + 1) : filePath;

  const touchesInterface = INTERFACE_PATH_PATTERNS.some((re) => re.test(relPath));
  if (!touchesInterface) process.exit(0);

  process.stderr.write(
    `You just edited ${relPath}, part of the Skynest MCP interface (tools, auth, or ` +
      `authorization). If this changed how a client authenticates, which tools exist, ` +
      `or their parameters/behavior, update the global skill at ` +
      `~/.claude/skills/skynest/SKILL.md to match before finishing this task — it's the ` +
      `only place other Claude Code sessions on this machine learn how to use this server.\n`,
  );
  process.exit(2);
});
