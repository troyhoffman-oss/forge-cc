# Harness Engineering Research Plan

## Goal
Design the optimal e2e autonomous development workflow for a solo engineer (Troy) using Claude Code, Flow skills, Linear, and verification tooling. Output: a recommended architecture and path forward.

## Core Question
"How do I go from idea → clean PR with minimal manual intervention?"

## Research Agents (Wave 1 — Parallel)

### Agent 1: Flow Plugin Deep Dive
Read EVERY skill file in the flow-plugin. Map the complete lifecycle.
Focus: Where does Troy currently have to intervene manually? What breaks the autonomous loop?

### Agent 2: Gap Analysis — OAI Article vs Troy's Current Setup
Compare the OAI harness engineering principles against Troy's current Flow + Claude Code setup.
Focus: What OAI has that Troy lacks. What's analogous. What's irrelevant (they have Codex cloud, Troy has Claude Code local).

### Agent 3: Linear Integration Audit
Understand how Linear currently integrates with Flow. Map the full issue lifecycle.
Focus: Where does Linear tracking break? What status transitions are manual?

### Agent 4: Verification & Feedback Loop Analysis
Analyze the current verification approach across all flow skills.
Focus: What gates exist, what's missing, where does the "loop until clean" pattern break?

### Agent 5: MCP Architecture Research
Research MCP server patterns for Claude Code. Understand what forge-mcp can and can't do.
Focus: What belongs in an MCP server vs skill files vs CLAUDE.md instructions?

## Synthesis (Wave 2)
Combine all 5 agent outputs into a single recommendation document.
