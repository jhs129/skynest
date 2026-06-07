---
title: "API Design Guidelines"
description: "REST API design standards for the platform"
type: document
tags:
  - "#engineering"
  - "#api"
  - "#guidelines"
status: published
version: 3
author: john.doe@example.com
created_at: 2024-01-15T10:30:00Z
updated_at: 2024-02-01T14:22:00Z
---

# API Design Guidelines

See [Architecture Overview](contextnest://nodes/architecture-overview) for context.

## Authentication

All API endpoints require Bearer token authentication.

## Error Handling

Use standard HTTP status codes. Return JSON error bodies.

## Rate Limiting

Limit requests to 100 per minute per API key.
