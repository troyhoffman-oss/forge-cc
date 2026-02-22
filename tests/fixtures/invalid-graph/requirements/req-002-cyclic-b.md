---
id: req-002
title: Cyclic Requirement B
dependsOn:
  - req-001
files:
  creates:
    - src/cyclic-b.ts
  modifies: []
acceptance:
  - This requirement is part of a dependency cycle
---

## Context
Part of a circular dependency chain for testing cycle detection.

## Technical Approach
N/A - this is a test fixture.
