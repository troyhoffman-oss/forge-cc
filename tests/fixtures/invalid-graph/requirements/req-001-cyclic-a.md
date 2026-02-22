---
id: req-001
title: Cyclic Requirement A
dependsOn:
  - req-003
  - req-999
files:
  creates:
    - src/cyclic-a.ts
  modifies: []
acceptance:
  - This requirement is part of a dependency cycle
---

## Context
Part of a circular dependency chain for testing cycle detection. Also references req-999 which does not exist (dangling edge).

## Technical Approach
N/A - this is a test fixture.
