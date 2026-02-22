---
id: req-orphan
title: Orphan Requirement
dependsOn: []
files:
  creates:
    - src/orphan.ts
  modifies: []
acceptance:
  - This file exists on disk but is not listed in _index.yaml
---

## Context
This requirement file exists in the requirements directory but has no corresponding entry in the _index.yaml requirements map. Used for testing orphan file detection.

## Technical Approach
N/A - this is a test fixture.
