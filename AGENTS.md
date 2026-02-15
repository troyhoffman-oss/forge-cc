# AGENTS.md -- forge-cc Instructions for Non-Claude Agents

forge-cc is a pre-PR verification tool. You must pass verification before committing code.

## Commands

```bash
# Run verification (required before every commit)
npx forge verify

# Check current status
npx forge status
```

## Rules

- Run `npx forge verify` and confirm all gates pass before any `git commit`.
- If verification fails, fix the reported errors and re-run until it passes.
- Never commit directly to `main` or `master`. Always use a feature branch.
- Exit code `0` means pass. Exit code `1` means fail.

## Configuration

- Config file: `.forge.json` in project root.
- If no config exists, gates are auto-detected from `package.json`.
- Default gates: `types` (tsc), `lint` (biome), `tests` (npm test).

## Structured Output

Use `npx forge verify --json` for machine-readable JSON results.

## Run Specific Gates

Use `--gate` to run only certain gates:

```bash
npx forge verify --gate types,lint
```

## More Information

See `README.md` for full documentation.
