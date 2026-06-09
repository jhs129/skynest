import { Section, SubSection, CodeBlock, InlineCode } from './shared';

const SKILL_TEMPLATE = `---
name: skynest
description: Use when starting any session that involves your vault, when needing context on stored knowledge, when asked to remember something, or when completing work that should be persisted.
---

# Skynest — Persistent Knowledge Vault

## Overview

Your Skynest vault is a knowledge base accessible via MCP. It stores documents,
notes, processes, and any structured knowledge you choose to save.
**Query it at session start** when the work touches topics you've previously
documented. **Save significant learnings** before ending a session.

## MCP Connection

The vault is accessed via the **skynest** MCP server. All tools are prefixed
\`mcp__skynest__*\`.

Before calling any tool, load the schema via ToolSearch:
\`\`\`
ToolSearch({ query: "select:mcp__skynest__vault_info" })
\`\`\`

For bulk loading all skynest tools:
\`\`\`
ToolSearch({ query: "skynest", max_results: 30 })
\`\`\`

## Session Start Protocol

At the start of any substantive session, run at minimum:

\`\`\`
mcp__skynest__vault_info          → confirm connection, orient to vault identity
mcp__skynest__search(query)       → find documents relevant to the current task
\`\`\`

## Selector Syntax (for \`resolve\` tool)

| Pattern        | Meaning                     | Example               |
|----------------|-----------------------------|-----------------------|
| \`#tag\`         | Documents with this tag     | \`#project\`            |
| \`#tag1 + #tag2\`| AND — must have both        | \`#project + #active\`  |
| \`#tag1 | #tag2\`| OR — has either             | \`#project | #process\` |
| \`type:document\`| Filter by node type         | \`type:document\`       |

**Hops** (graph traversal depth): default 2.
Use \`hops: 1\` for fast single-doc lookups; \`hops: 3\` for deep context on
interconnected topics.

## Common Operations

\`\`\`javascript
// Search by topic
mcp__skynest__search({ query: "your topic here", hops: 2 })

// Find by tag
mcp__skynest__resolve({ selector: "#project + #active", hops: 2 })

// Read a specific document
mcp__skynest__read_document({ uri: "nodes/your/path" })

// List all documents
mcp__skynest__list_documents({ type: "document", status: "published" })
\`\`\`

## Saving Knowledge

Use this when asked to remember something, or when you complete work with
lasting value:

\`\`\`
1. mcp__skynest__create_document({ path, title, type, tags, body })
2. mcp__skynest__update_document({ path, body })   ← if document already exists
3. mcp__skynest__publish_document({ path, author: "claude@claude.ai", note: "..." })
\`\`\`

**Document types:** \`document\`, \`snippet\`, \`glossary\`, \`persona\`, \`prompt\`,
\`source\`, \`tool\`, \`reference\`, \`skill\`

**Always publish after creating/updating** — drafts are not visible to AI agents.

## Quick Reference

| Goal              | Tool                              | Key Params                          |
|-------------------|-----------------------------------|-------------------------------------|
| Orient to vault   | \`mcp__skynest__vault_info\`        | —                                   |
| Search by topic   | \`mcp__skynest__search\`            | \`query\`, \`hops\`                     |
| Filter by tag     | \`mcp__skynest__resolve\`           | \`selector\`, \`hops\`                  |
| Read one doc      | \`mcp__skynest__read_document\`     | \`uri\`                               |
| Read a pack       | \`mcp__skynest__read_pack\`         | \`id\`, \`hops\`                        |
| List documents    | \`mcp__skynest__list_documents\`    | \`type\`, \`tag\`, \`status\`             |
| Create new        | \`mcp__skynest__create_document\`   | \`path\`, \`title\`, \`type\`, \`tags\`, \`body\` |
| Update existing   | \`mcp__skynest__update_document\`   | \`path\`, \`body\`                      |
| Publish/version   | \`mcp__skynest__publish_document\`  | \`path\`, \`note\`                      |
| Audit trail       | \`mcp__skynest__verify_integrity\`  | —                                   |

## Common Mistakes

- **Not publishing after saving**: Always call \`publish_document\` after
  create/update or the content won't be visible to AI agents.
- **Wrong selector syntax**: Tags use a \`#\` prefix (\`#project\`, not \`tag:project\`).
- **Skipping vault at session start**: Query first — don't assume you know the
  current state of your documents.
- **Saving code implementations**: The vault is for knowledge, not source code;
  those belong in git.
`;

export function DocsSkill() {
  return (
    <Section id="skill" title="Claude Code skill">
      <div className="space-y-6 text-gray-600">
        <p className="text-sm">
          A <strong>Claude Code skill</strong> is a Markdown file that Claude loads on demand to
          guide how it interacts with a specific tool or service. Creating a Skynest skill teaches
          Claude your vault&apos;s structure and gives it a repeatable protocol for querying and
          saving knowledge — so you don&apos;t have to re-explain it each session.
        </p>

        <SubSection title="Create the skill file">
          <p className="text-sm">
            Save the following template to{' '}
            <InlineCode>~/.claude/skills/skynest/skill.md</InlineCode> (create the directory if it
            doesn&apos;t exist). Customise the{' '}
            <InlineCode>description</InlineCode> frontmatter and the vault structure section to
            match your own vault layout and tags.
          </p>
          <CodeBlock>{SKILL_TEMPLATE}</CodeBlock>
        </SubSection>

        <SubSection title="Activate the skill">
          <p className="text-sm">
            Once the file is in place, invoke the skill by typing{' '}
            <InlineCode>/skynest</InlineCode> in Claude Code. Claude will load the skill and follow
            its protocol for the rest of the session.
          </p>
          <p className="text-sm">
            You can also configure the skill&apos;s <InlineCode>description</InlineCode> so that
            Claude activates it automatically when the session context matches — for example,
            whenever you start a session related to a project or topic your vault covers.
          </p>
        </SubSection>

        <SubSection title="Customising the template">
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li>
              Update the <strong>vault structure</strong> section with your actual{' '}
              <InlineCode>nodes/</InlineCode> paths and tags once you&apos;ve organised your vault.
            </li>
            <li>
              Add <strong>workflow packs</strong> if you create named packs in your vault — call
              them with{' '}
              <InlineCode>{'mcp__skynest__read_pack({ id: "pack-name", hops: 2 })'}</InlineCode>.
            </li>
            <li>
              Extend the <strong>common queries</strong> section with tag combinations specific to
              your domain.
            </li>
          </ul>
        </SubSection>
      </div>
    </Section>
  );
}
