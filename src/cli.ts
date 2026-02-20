#!/usr/bin/env node
import { program } from 'commander';
import { loadConfig } from './config/loader.js';
import { registerGate, runPipeline } from './gates/index.js';
import { typesGate } from './gates/types-gate.js';
import { lintGate } from './gates/lint-gate.js';
import { testsGate } from './gates/tests-gate.js';
import { writeVerifyCache } from './state/cache.js';
import { readStatus, discoverStatuses, findNextPending } from './state/status.js';
import { ForgeLinearClient, IssueRelationType } from './linear/client.js';
import { syncMilestoneStart, syncMilestoneComplete, syncProjectDone } from './linear/sync.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));

program
  .name('forge')
  .version(pkg.version)
  .description('Forge — verification harness for Claude Code agents');

program
  .command('verify')
  .description('Run verification gates')
  .option('--gate <gates>', 'Comma-separated list of gates to run')
  .option('--json', 'Output results as JSON')
  .action(async (opts: { gate?: string; json?: boolean }) => {
    const projectDir = process.cwd();
    const config = await loadConfig(projectDir);

    // Register default gates
    registerGate(typesGate);
    registerGate(lintGate);
    registerGate(testsGate);

    // Filter gates if --gate flag provided
    if (opts.gate) {
      const requested = opts.gate.split(',').map((g) => g.trim());
      config.gates = requested;
    }

    const pipeline = await runPipeline(config, projectDir);

    // Write cache
    await writeVerifyCache(projectDir, pipeline);

    if (opts.json) {
      console.log(JSON.stringify(pipeline, null, 2));
    } else {
      // Human-readable output
      for (const gate of pipeline.gates) {
        const status = gate.passed ? 'PASS' : 'FAIL';
        console.log(`${gate.gate}: ${status} (${gate.durationMs}ms)`);
        for (const err of gate.errors) {
          const loc = err.file ? `${err.file}:${err.line}` : '(no file)';
          console.log(`  - ${loc}: ${err.message}`);
        }
      }
      console.log(`\nResult: ${pipeline.result} (${pipeline.durationMs}ms)`);
    }

    process.exit(pipeline.result === 'PASSED' ? 0 : 1);
  });

program
  .command('run')
  .description('Execute milestones via Ralph loop')
  .requiredOption('--prd <slug>', 'PRD slug to execute')
  .action(async (opts: { prd: string }) => {
    const { runRalphLoop } = await import('./runner/loop.js');
    await runRalphLoop({ slug: opts.prd, projectDir: process.cwd() });
  });

program
  .command('status')
  .description('Show PRD progress')
  .action(async () => {
    const projectDir = process.cwd();
    const statuses = await discoverStatuses(projectDir);
    if (statuses.length === 0) {
      console.log('No PRD status files found.');
      return;
    }
    const pending = findNextPending(statuses);
    const pendingMap = new Map(pending.map((p) => [p.slug, p.milestone]));

    // Calculate column widths
    const rows = statuses.map((s) => {
      const keys = Object.keys(s.milestones);
      const complete = keys.filter((k) => s.milestones[k].status === 'complete').length;
      const total = keys.length;
      const next = pendingMap.get(s.slug);
      const linearState = s.linearProjectId ? 'linked' : '-';
      return {
        project: s.project,
        branch: s.branch,
        progress: `${complete}/${total}`,
        next: complete === total ? '(done)' : next ?? '-',
        linear: linearState,
      };
    });

    const headers = { project: 'Project', branch: 'Branch', progress: 'Progress', next: 'Next', linear: 'Linear' };
    const cols = (Object.keys(headers) as Array<keyof typeof headers>).map((key) => {
      const max = Math.max(headers[key].length, ...rows.map((r) => r[key].length));
      return { key, width: max };
    });

    const headerLine = cols.map((c) => headers[c.key].padEnd(c.width)).join('  ');
    console.log(headerLine);
    console.log(cols.map((c) => '-'.repeat(c.width)).join('  '));
    for (const row of rows) {
      console.log(cols.map((c) => row[c.key].padEnd(c.width)).join('  '));
    }
  });

program
  .command('setup')
  .description('Initialize forge for a project')
  .option('--skills-only', 'Only sync skill files')
  .action(async (opts: { skillsOnly?: boolean }) => {
    const { runSetup } = await import('./setup.js');
    await runSetup({ projectDir: process.cwd(), skillsOnly: opts.skillsOnly });
  });

const linear = program
  .command('linear')
  .description('Linear project management commands');

// --- Create commands ---

linear
  .command('create-project')
  .description('Create a new Linear project')
  .requiredOption('--name <name>', 'Project name')
  .requiredOption('--team <teamId>', 'Team ID')
  .option('--description <desc>', 'Project description')
  .option('--priority <n>', 'Priority (0-4)', parseInt)
  .action(async (opts: { name: string; team: string; description?: string; priority?: number }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    const client = new ForgeLinearClient({ apiKey });
    const result = await client.createProject({
      name: opts.name,
      description: opts.description,
      teamIds: [opts.team],
      priority: opts.priority,
    });
    if (!result.success) {
      console.error(JSON.stringify({ error: result.error }));
      process.exit(1);
    }
    console.log(JSON.stringify(result.data));
  });

linear
  .command('create-milestone')
  .description('Create a milestone within a project')
  .requiredOption('--project <id>', 'Project ID')
  .requiredOption('--name <name>', 'Milestone name')
  .option('--description <desc>', 'Milestone description')
  .action(async (opts: { project: string; name: string; description?: string }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    const client = new ForgeLinearClient({ apiKey });
    const result = await client.createMilestone({
      name: opts.name,
      description: opts.description,
      projectId: opts.project,
    });
    if (!result.success) {
      console.error(JSON.stringify({ error: result.error }));
      process.exit(1);
    }
    console.log(JSON.stringify(result.data));
  });

linear
  .command('create-issue')
  .description('Create a single Linear issue')
  .requiredOption('--team <teamId>', 'Team ID')
  .requiredOption('--title <title>', 'Issue title')
  .option('--project <id>', 'Project ID')
  .option('--milestone <id>', 'Milestone ID')
  .option('--description <desc>', 'Issue description')
  .option('--priority <n>', 'Priority (0-4)', parseInt)
  .action(async (opts: { team: string; title: string; project?: string; milestone?: string; description?: string; priority?: number }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    const client = new ForgeLinearClient({ apiKey, teamId: opts.team });
    const result = await client.createIssue({
      title: opts.title,
      description: opts.description,
      teamId: opts.team,
      projectId: opts.project,
      projectMilestoneId: opts.milestone,
      priority: opts.priority,
    });
    if (!result.success) {
      console.error(JSON.stringify({ error: result.error }));
      process.exit(1);
    }
    console.log(JSON.stringify(result.data));
  });

linear
  .command('create-issue-batch')
  .description('Create multiple issues in a batch')
  .requiredOption('--team <teamId>', 'Team ID')
  .requiredOption('--project <id>', 'Project ID')
  .requiredOption('--milestone <id>', 'Milestone ID')
  .requiredOption('--issues <json>', 'JSON array of issues [{title, description?, priority?}]')
  .action(async (opts: { team: string; project: string; milestone: string; issues: string }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    let parsed: Array<{ title: string; description?: string; priority?: number }>;
    try {
      parsed = JSON.parse(opts.issues);
    } catch {
      console.error(JSON.stringify({ error: 'Invalid JSON for --issues' }));
      process.exit(1);
    }
    if (!Array.isArray(parsed)) {
      console.error(JSON.stringify({ error: '--issues must be a JSON array' }));
      process.exit(1);
    }
    const client = new ForgeLinearClient({ apiKey, teamId: opts.team });
    const issues = parsed.map((i) => ({
      title: i.title,
      description: i.description,
      teamId: opts.team,
      projectId: opts.project,
      projectMilestoneId: opts.milestone,
      priority: i.priority,
    }));
    const result = await client.createIssueBatch(issues);
    if (!result.success) {
      console.error(JSON.stringify({ error: result.error }));
      process.exit(1);
    }
    console.log(JSON.stringify(result.data));
  });

linear
  .command('create-project-relation')
  .description('Create a relation between two projects')
  .requiredOption('--project <id>', 'Project ID')
  .requiredOption('--related-project <id>', 'Related project ID')
  .requiredOption('--type <type>', 'Relation type (blocks|related)')
  .action(async (opts: { project: string; relatedProject: string; type: string }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    const client = new ForgeLinearClient({ apiKey });
    const result = await client.createProjectRelation({
      projectId: opts.project,
      relatedProjectId: opts.relatedProject,
      type: opts.type,
    });
    if (!result.success) {
      console.error(JSON.stringify({ error: result.error }));
      process.exit(1);
    }
    console.log(JSON.stringify(result.data));
  });

linear
  .command('create-issue-relation')
  .description('Create a relation between two issues')
  .requiredOption('--issue <id>', 'Issue ID')
  .requiredOption('--related-issue <id>', 'Related issue ID')
  .requiredOption('--type <type>', 'Relation type (blocks|duplicate|related)')
  .action(async (opts: { issue: string; relatedIssue: string; type: string }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    const validTypes: string[] = Object.values(IssueRelationType);
    if (!validTypes.includes(opts.type)) {
      console.error(JSON.stringify({ error: `Invalid relation type "${opts.type}". Valid: ${validTypes.join(', ')}` }));
      process.exit(1);
    }
    const client = new ForgeLinearClient({ apiKey });
    const result = await client.createIssueRelation({
      issueId: opts.issue,
      relatedIssueId: opts.relatedIssue,
      type: opts.type as IssueRelationType,
    });
    if (!result.success) {
      console.error(JSON.stringify({ error: result.error }));
      process.exit(1);
    }
    console.log(JSON.stringify(result.data));
  });

// --- List commands ---

linear
  .command('list-teams')
  .description('List all Linear teams')
  .action(async () => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    const client = new ForgeLinearClient({ apiKey });
    const teams = await client.listTeams();
    console.log(JSON.stringify(teams));
  });

linear
  .command('list-projects')
  .description('List projects for a team')
  .requiredOption('--team <teamId>', 'Team ID')
  .action(async (opts: { team: string }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    const client = new ForgeLinearClient({ apiKey });
    const projects = await client.listProjects(opts.team);
    console.log(JSON.stringify(projects));
  });

// --- Sync commands (moved from linear-sync) ---

linear
  .command('sync-start')
  .description('Start a milestone sync')
  .requiredOption('--slug <slug>', 'PRD slug')
  .requiredOption('--milestone <n>', 'Milestone number')
  .action(async (opts: { slug: string; milestone: string }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    try {
      const projectDir = process.cwd();
      const status = await readStatus(projectDir, opts.slug);
      if (!status.linearTeamId) {
        console.error(JSON.stringify({ error: 'No linearTeamId in status file' }));
        process.exit(1);
      }
      const client = new ForgeLinearClient({ apiKey, teamId: status.linearTeamId });
      const config = await loadConfig(projectDir);
      await syncMilestoneStart(client, config, status, opts.milestone);
      console.log(`[forge] linear sync-start complete for ${opts.slug} ${opts.milestone}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ error: message }));
      process.exit(1);
    }
  });

linear
  .command('sync-complete')
  .description('Complete a milestone sync')
  .requiredOption('--slug <slug>', 'PRD slug')
  .requiredOption('--milestone <n>', 'Milestone number')
  .option('--last', 'This is the last milestone')
  .action(async (opts: { slug: string; milestone: string; last?: boolean }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    try {
      const projectDir = process.cwd();
      const status = await readStatus(projectDir, opts.slug);
      if (!status.linearTeamId) {
        console.error(JSON.stringify({ error: 'No linearTeamId in status file' }));
        process.exit(1);
      }
      const client = new ForgeLinearClient({ apiKey, teamId: status.linearTeamId });
      const config = await loadConfig(projectDir);
      await syncMilestoneComplete(client, config, status, opts.milestone, !!opts.last);
      console.log(`[forge] linear sync-complete finished for ${opts.slug} ${opts.milestone}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ error: message }));
      process.exit(1);
    }
  });

linear
  .command('sync-done')
  .description('Mark project as done in Linear')
  .requiredOption('--slug <slug>', 'PRD slug')
  .action(async (opts: { slug: string }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    try {
      const projectDir = process.cwd();
      const status = await readStatus(projectDir, opts.slug);
      if (!status.linearTeamId) {
        console.error(JSON.stringify({ error: 'No linearTeamId in status file' }));
        process.exit(1);
      }
      const client = new ForgeLinearClient({ apiKey, teamId: status.linearTeamId });
      const config = await loadConfig(projectDir);
      await syncProjectDone(client, config, status);
      console.log(`[forge] linear sync-done complete for ${opts.slug}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ error: message }));
      process.exit(1);
    }
  });

linear
  .command('list-issues')
  .description('List all Linear issue identifiers for a PRD slug')
  .requiredOption('--slug <slug>', 'PRD slug')
  .action(async (opts: { slug: string }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
      process.exit(1);
    }
    try {
      const projectDir = process.cwd();
      const status = await readStatus(projectDir, opts.slug);
      if (!status.linearProjectId) {
        console.error(JSON.stringify({ error: 'No linearProjectId in status file' }));
        process.exit(1);
      }
      if (!status.linearTeamId) {
        console.error(JSON.stringify({ error: 'No linearTeamId in status file' }));
        process.exit(1);
      }
      const client = new ForgeLinearClient({ apiKey, teamId: status.linearTeamId });
      const issues = await client.listIssuesByProject(status.linearProjectId);
      const identifiers = issues.map((i) => i.identifier);
      console.log(JSON.stringify(identifiers));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ error: message }));
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Check environment')
  .action(async () => {
    const { runDoctor } = await import('./doctor.js');
    const result = await runDoctor(process.cwd());
    for (const check of result.checks) {
      const icon = check.status === 'ok' ? '\u2713' : check.status === 'warn' ? '!' : '\u2717';
      console.log(`  ${icon} ${check.name}: ${check.message}`);
    }
    console.log(result.ok ? '\nEnvironment ready.' : '\nSome checks failed.');
    process.exit(result.ok ? 0 : 1);
  });

program
  .command('update')
  .description('Check for and install forge updates')
  .action(async () => {
    const { checkForUpdate } = await import('./runner/update.js');
    await checkForUpdate(process.cwd());
  });

program.parse();
