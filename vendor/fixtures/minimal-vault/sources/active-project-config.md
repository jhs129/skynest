---
title: "Active Project Config"
type: source
tags:
  - "#config"
status: published
version: 1
source:
  transport: mcp
  server: jira
  tools:
    - jira_get_project
  cache_ttl: 3600
---

# Active Project Config

This source provides the current project configuration from Jira.

## Fetch the project

Call `jira_get_project` with:

- `project_key`: "ENG"

The result contains the project name, lead, board ID, and active sprint ID.

## If this call fails

Tell the user that project data is unavailable.
