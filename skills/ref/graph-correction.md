# Graph Correction Protocol

Reference for mid-execution graph corrections during `forge:build`. Apply these rules when the execution graph needs modification after planning is complete.

## Correction Types

### 1. New Requirement Discovered

When an agent discovers work not captured in the original plan:

1. Create a requirement file named `disc-NNN` (use next available number)
2. Add to `_index.yaml` with `status: discovered`
3. Surface to user at the next checkpoint with a summary of what was found and why it is needed
4. **User approves** — set status to `pending`, add to scheduling queue, re-run `computeWaves()` to place it in the correct wave
5. **User rejects** — set status to `rejected`, record the rejection reason in the requirement entry

Never auto-approve discovered requirements, even in `--auto` mode. Scope changes always require human confirmation.

### 2. Missing Dependency Edge

When an agent reports a dependency not in the graph (e.g., "req-005 needs req-002 to be done first because [reason]"):

1. **Validate first:** Run `detectCycles()` on the proposed graph with the new edge added
2. **No cycle detected:** Apply the edge to `_index.yaml` via `writeIndex()`. Log the addition.
3. **Cycle detected:** Do NOT apply. Surface to user with:
   - The proposed edge and reason
   - The cycle path that would be created
   - Ask user how to resolve (remove a different edge, merge requirements, or reject)

### 3. File Scope Correction

When an agent touches files not listed in the requirement's `files` array:

1. Update the requirement's file scope in `_index.yaml` to include the additional files
2. This is informational metadata for wave scheduling — apply silently
3. No user confirmation needed; this does not change what work is done, only what files are tracked

### 4. Group Ordering Correction

When an agent discovers that one group should depend on another:

1. Surface to user: "Should group '[Group B]' depend on group '[Group A]'? Reason: [agent's explanation]"
2. **User approves:** Update the `groups` section in `_index.yaml` to add the dependency
3. Re-run `computeWaves()` to recalculate the execution plan
4. **User rejects:** Continue with current ordering, log the rejection

## Checkpoint Timing

Apply corrections at these points only:

- **After** each requirement completes (success or failure)
- **Before** starting the next requirement
- **Never** mid-execution of a requirement

Corrections are batched: if multiple corrections are pending at a checkpoint, apply them all before resuming execution. Process in this order:

1. File scope corrections (silent, no user input)
2. Missing dependency edges (auto-apply if no cycle)
3. Group ordering corrections (require user input)
4. New requirements (require user input)

## Auto-Apply Rules (--auto mode)

| Correction Type      | Behavior          | Reason                                      |
|----------------------|-------------------|----------------------------------------------|
| File scope           | Always auto-apply | Informational only, no structural change     |
| New edge (no cycle)  | Auto-apply        | Preserves correctness without scope change   |
| New edge (cycle)     | Queue for user    | Cannot resolve cycles without human judgment |
| New requirement      | Queue for user    | Scope changes require human approval         |
| Group ordering       | Queue for user    | Affects execution plan significantly         |

When items are queued for user review in `--auto` mode, pause execution at the checkpoint and present all queued items together. Resume only after all items are resolved.

## Applying Corrections

When writing corrections to `_index.yaml`:

1. Read current index state with `readIndex()`
2. Apply the correction to the in-memory structure
3. Validate the full graph (run `detectCycles()`, verify all referenced requirements exist)
4. Write back with `writeIndex()`
5. If the correction affects wave composition, re-run `computeWaves()` and log the updated plan

## Error Handling

- If `writeIndex()` fails, retry once. On second failure, surface error to user and pause.
- If `detectCycles()` itself errors, treat the proposed change as unsafe — queue for user review.
- If a discovered requirement references files already owned by an in-progress requirement, flag the conflict and queue for user review regardless of mode.
