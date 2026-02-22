---
id: req-004
title: Admin Panel
dependsOn:
  - req-001
files:
  creates:
    - src/admin/dashboard.ts
  modifies:
    - src/config.ts
acceptance:
  - Admin dashboard page renders user and system stats
  - Admin settings are added to src/config.ts
  - Only accessible to users with admin role
---

## Context
Add an admin panel for system management. Depends only on project setup, so it can proceed in parallel with auth work. Note: this modifies src/config.ts which is also modified by req-002, creating a file conflict.

## Technical Approach
Create a dashboard module that reads system state and renders admin views. Add admin-specific configuration to the shared config file.
