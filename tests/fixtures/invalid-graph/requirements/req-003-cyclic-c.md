---
id: req-003
title: Cyclic Requirement C
dependsOn:
  - req-002
files:
  creates:
    - src/cyclic-c.ts
  modifies: []
acceptance:
  - This requirement is part of a dependency cycle
---

## Context
Part of a circular dependency chain for testing cycle detection. Also references group "nonexistent" which is not defined in the index.

## Technical Approach
N/A - this is a test fixture.
