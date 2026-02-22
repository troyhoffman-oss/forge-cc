---
id: req-003
title: API Endpoints
dependsOn:
  - req-001
  - req-002
files:
  creates:
    - src/api/routes.ts
    - src/api/handlers.ts
  modifies:
    - src/index.ts
acceptance:
  - REST API routes are registered in the main app
  - Handlers implement CRUD operations for core resources
  - Protected routes use auth middleware
---

## Context
Build the REST API layer on top of the authenticated project. This is blocked until both project setup and auth are complete.

## Technical Approach
Create route definitions and handler functions. Wire routes into the main entry point. Apply auth middleware to protected endpoints.
