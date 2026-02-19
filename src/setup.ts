import { readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

export interface SetupOptions {
  projectDir: string;
  skillsOnly?: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");

const FORGE_CLAUDE_SECTION = `
## Forge Quick Reference

| Action | Command |
|--------|---------|
| Run verification | \`npx forge verify\` |
| Run specific gates | \`npx forge verify --gate types,lint\` |
| Check status | \`npx forge status\` |
| Check environment | \`npx forge doctor\` |

## Session Protocol
- **On start:** Read CLAUDE.md, .planning/status/*.json, tasks/lessons.md
- **When lost:** Re-read planning docs

## Session Protocol END (Mandatory)
1. Update .planning/status/<slug>.json
2. Update tasks/lessons.md (max 10 active)
3. Commit doc updates to the feature branch
`;

/** Copy skill .md files from the forge-cc package to ~/.claude/commands/forge/. */
async function installSkills(): Promise<string[]> {
  const skillsSource = join(packageRoot, "skills");
  const targetDir = join(homedir(), ".claude", "commands", "forge");
  await mkdir(targetDir, { recursive: true });

  let files: string[];
  try {
    files = await readdir(skillsSource);
  } catch {
    return [];
  }

  const installed: string[] = [];
  for (const file of files) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    await copyFile(join(skillsSource, file), join(targetDir, file));
    installed.push(file);
  }
  return installed;
}

/** Generate .forge.json with auto-detected gates if it doesn't already exist. */
async function generateForgeConfig(projectDir: string): Promise<boolean> {
  const configPath = join(projectDir, ".forge.json");

  // Don't overwrite existing config
  try {
    await readFile(configPath, "utf-8");
    return false;
  } catch {
    // File doesn't exist, proceed to create
  }

  // Auto-detect gates from package.json
  const gateMap: Record<string, string> = {
    typescript: "types",
    biome: "lint",
    vitest: "tests",
    jest: "tests",
  };
  const gates = new Set<string>(["types", "lint", "tests"]);

  try {
    const pkgContent = await readFile(join(projectDir, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    const detected = new Set<string>();
    for (const [dep, gate] of Object.entries(gateMap)) {
      if (dep in deps) detected.add(gate);
    }
    if (detected.size > 0) {
      gates.clear();
      for (const g of detected) gates.add(g);
    }
  } catch {
    // No package.json, use defaults
  }

  // Detect Linear team if key is set
  let linearTeam = "";
  const apiKey = process.env.LINEAR_API_KEY;
  if (apiKey) {
    try {
      const { ForgeLinearClient } = await import("./linear/client.js");
      const client = new ForgeLinearClient({ apiKey });
      const teams = await client.listTeams();
      if (teams.length === 1) {
        linearTeam = teams[0].key;
      } else if (teams.length > 1) {
        console.log("Linear teams found:");
        for (const team of teams) {
          console.log(`  ${team.key} — ${team.name}`);
        }
        console.log('Set "linearTeam" in .forge.json to your team key.');
      }
    } catch {
      // Linear not reachable, skip
    }
  }

  const config = {
    gates: [...gates],
    maxIterations: 5,
    verifyFreshness: 600000,
    linearTeam,
  };

  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return true;
}

/** Copy pre-commit hook to .forge/hooks/ in the project. */
async function installPreCommitHook(projectDir: string): Promise<boolean> {
  const hookSource = join(packageRoot, "hooks", "pre-commit-verify.js");
  const hookTarget = join(projectDir, ".forge", "hooks", "pre-commit-verify.js");

  try {
    await readFile(hookSource);
  } catch {
    return false;
  }

  await mkdir(join(projectDir, ".forge", "hooks"), { recursive: true });
  await copyFile(hookSource, hookTarget);
  return true;
}

/** Append forge section to CLAUDE.md if not already present. */
async function updateClaudeMd(projectDir: string): Promise<boolean> {
  const claudeMdPath = join(projectDir, "CLAUDE.md");
  let content = "";

  try {
    content = await readFile(claudeMdPath, "utf-8");
  } catch {
    // File doesn't exist, create with forge content
    await writeFile(claudeMdPath, `# Project Instructions\n${FORGE_CLAUDE_SECTION}`, "utf-8");
    return true;
  }

  // Check if forge content is already present
  if (content.includes("## Forge Quick Reference") || content.includes("npx forge verify")) {
    return false;
  }

  await writeFile(claudeMdPath, content.trimEnd() + "\n" + FORGE_CLAUDE_SECTION, "utf-8");
  return true;
}

/** Validate Linear connection if API key is set. */
async function validateLinear(): Promise<boolean> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return false;

  try {
    const { ForgeLinearClient } = await import("./linear/client.js");
    const client = new ForgeLinearClient({ apiKey });
    const teams = await client.listTeams();
    if (teams.length > 0) {
      console.log(`Linear: authenticated (${teams.length} team${teams.length > 1 ? "s" : ""} found)`);
      return true;
    }
    console.log("Linear: authenticated but no teams found");
    return true;
  } catch {
    console.log("Linear: connection failed");
    return false;
  }
}

export async function runSetup(opts: SetupOptions): Promise<void> {
  const { projectDir, skillsOnly } = opts;

  // Step 2: Install skill files (always runs)
  const installed = await installSkills();
  if (installed.length > 0) {
    console.log(`Skills synced: ${installed.join(", ")}`);
  }

  if (skillsOnly) return;

  // Step 1: Generate .forge.json
  const configCreated = await generateForgeConfig(projectDir);
  if (configCreated) {
    console.log("Created .forge.json");
  } else {
    console.log(".forge.json already exists, skipping");
  }

  // Step 3: Install pre-commit hook
  const hookInstalled = await installPreCommitHook(projectDir);
  if (hookInstalled) {
    console.log("Pre-commit hook installed at .forge/hooks/pre-commit-verify.js");
    console.log("Add to .claude/settings.json hooks to activate");
  }

  // Step 4: Update CLAUDE.md
  const claudeUpdated = await updateClaudeMd(projectDir);
  if (claudeUpdated) {
    console.log("Forge section added to CLAUDE.md");
  }

  // Step 5: Validate Linear
  await validateLinear();

  console.log("\nSetup complete. Run 'npx forge doctor' to verify your environment.");
}
