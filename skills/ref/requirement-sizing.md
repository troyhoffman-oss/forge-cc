# Requirement Sizing Reference

This document defines sizing rules, splitting guidelines, and vertical slice examples for `forge:plan`. Use these rules when creating, reviewing, or splitting requirements.

## Hard Limits (Automatic Split Required)

If any of these thresholds are exceeded, the requirement MUST be split before proceeding:

| Metric | Threshold | Action |
|--------|-----------|--------|
| Acceptance criteria | > 6 | Split into smaller requirements |
| Files touched (creates + modifies combined) | > 5 | Split into smaller requirements |
| Groups referenced | > 2 | Split — a requirement should belong to exactly 1 group |

When a hard limit is triggered during `forge:plan`, block the requirement from being finalized and require the user to split it.

## Soft Limits (Warning During forge:plan)

These thresholds trigger warnings but do not block progress:

| Metric | Threshold | Warning |
|--------|-----------|---------|
| Acceptance criteria | > 4 | "Consider splitting" |
| Files touched | > 3 | "Consider splitting" |
| Acceptance criteria spanning multiple user behaviors | Any | "This is 2+ requirements" |

When a soft limit is triggered, emit the warning and allow the user to proceed or split.

## How to Split

Each split produces **vertical slices** — requirements that deliver end-to-end user-facing value. Follow this process:

1. **Identify distinct user-facing behaviors** in the oversized requirement. Each behavior that a user can independently observe or interact with is a candidate slice.
2. **Each behavior becomes its own requirement** with end-to-end scope (database to UI, or API to integration — whatever the full stack for that behavior is).
3. **Add dependency edges** between slices where execution order matters. Use `dependsOn` to express that one requirement must complete before another can start.
4. **Preserve the original requirement's group assignment.** All slices inherit the same group as the parent requirement.

### Splitting Rules

- Never split by technical layer (database, API, UI). Always split by user behavior.
- Each slice must be independently testable — it should have its own acceptance criteria that can be verified without completing other slices.
- If two behaviors share a file, assign the file to whichever slice creates it. The other slice lists it as a modification.
- Prefer 2-4 acceptance criteria per slice. If a slice still exceeds hard limits after splitting, split again.

## Vertical Slice Examples

### Bad: Horizontal Layer Splitting

Splitting by technical layer creates requirements that have no standalone user value:

```
req-001: "Set up auth database tables"
req-002: "Build auth API endpoints"
req-003: "Create auth UI components"
```

Problems:
- No single requirement delivers working functionality
- Testing requires all three to be complete
- Changes to one layer cascade to all requirements
- Integration risk is deferred to the end

### Good: Vertical Slice Splitting

Each requirement delivers a complete, testable user behavior:

```
req-001: "User can register with email/password"
  creates: src/db/migrations/add-users.ts, src/api/register.ts, src/components/RegisterForm.tsx
  acceptance criteria:
    - User submits registration form with email and password
    - Account is created in the database
    - User receives confirmation and is redirected to login

req-002: "User can log in and see dashboard"
  creates: src/api/login.ts, src/components/LoginForm.tsx, src/middleware/auth.ts
  dependsOn: [req-001]
  acceptance criteria:
    - User submits login form with valid credentials
    - Session is created and user sees the dashboard
    - Invalid credentials show an error message

req-003: "User can reset forgotten password"
  creates: src/api/reset-password.ts, src/components/ResetForm.tsx
  dependsOn: [req-001]
  acceptance criteria:
    - User requests a password reset via email
    - User sets a new password using the reset link
    - User can log in with the new password
```

Benefits:
- Each requirement is independently deployable and testable
- Risk is surfaced early — integration happens within each slice
- Dependencies are explicit and minimal
- Progress is measurable in user-visible outcomes

### Another Example: Settings Feature

**Before (oversized, 8 acceptance criteria):**
```
req-010: "User can manage account settings"
  - User can change display name
  - User can change email
  - User can upload avatar
  - User can enable 2FA
  - User can change password
  - User can delete account
  - User can export data
  - User can manage notification preferences
```

**After (vertical slices):**
```
req-010a: "User can update profile information"
  acceptance criteria:
    - User can change display name
    - User can change email with verification
    - User can upload and crop avatar

req-010b: "User can manage security settings"
  acceptance criteria:
    - User can change password (requires current password)
    - User can enable/disable 2FA

req-010c: "User can manage account lifecycle"
  acceptance criteria:
    - User can export account data as JSON
    - User can delete account with confirmation

req-010d: "User can configure notification preferences"
  acceptance criteria:
    - User can toggle email notifications by category
    - User can set notification frequency
```

## Quick Checklist for forge:plan

When evaluating a requirement during planning:

1. Count acceptance criteria. More than 6? **Must split.** More than 4? **Warn.**
2. Count files (creates + modifies). More than 5? **Must split.** More than 3? **Warn.**
3. Count groups referenced. More than 2? **Must split.**
4. Read each acceptance criterion. Do any describe different user behaviors? **Warn: "This is 2+ requirements."**
5. After splitting, verify each slice is a vertical slice with end-to-end scope.
6. Add `dependsOn` edges where one slice requires another to be complete first.
