---
title: "Current Sprint Tickets"
type: source
tags:
  - "#engineering"
  - "#sprint"
status: published
version: 1
source:
  transport: mcp
  server: jira
  tools:
    - jira_get_active_sprint
    - jira_get_sprint_issues
  depends_on:
    - "contextnest://sources/active-project-config"
  cache_ttl: 300
---

# Current Sprint Tickets

This source provides live sprint data from Jira. Before fetching
tickets, you need the project configuration from the
[Active Project Config](contextnest://sources/active-project-config).

## Step 1: Get the active sprint

Call `jira_get_active_sprint` with the board_id from Active Project Config.

## Step 2: Get the tickets

Call `jira_get_sprint_issues` with the sprint_id from Step 1.
