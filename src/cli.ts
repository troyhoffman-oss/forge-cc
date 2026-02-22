#!/usr/bin/env node
import { program } from 'commander';
import { loadConfig } from './config/loader.js';
import { registerGate, runPipeline } from './gates/index.js';
import { typesGate } from './gates/types-gate.js';
import { lintGate } from './gates/lint-gate.js';
import { testsGate } from './gates/tests-gate.js';
import { writeVerifyCache } from './state/cache.js';
import { ForgeLinearClient, IssueRelationType, type LinearResult } from './linear/client.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { discoverGraphs, loadIndex } from './graph/reader.js';
import { findReady, groupStatus, isProjectComplete } from './graph/query.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));

function requireApiKey(): string {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error(JSON.stringify({ error: 'LINEAR_API_KEY not set' }));
    process.exit(1);
  }
  return apiKey;
}

function handleResult<T>(result: LinearResult<T>): T {
  if (!result.success) {
    console.error(JSON.stringify({ error: result.error }));
    process.exit(1);
  }
  return result.data;
}

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
  .description('Execute graph requirements')
  .requiredOption('--prd <slug>', 'Slug to execute')
  .action(async (opts: { prd: string }) => {
    const projectDir = process.cwd();
    const { runGraphLoop } = await import('./runner/loop.js');
    await runGraphLoop({ slug: opts.prd, projectDir });
  });

program
  .command('status')
  .description('Show project progress')
  .action(async () => {
    const projectDir = process.cwd();

    // Collect rows from graph directories
    const rows: Array<{ project: string; branch: string; progress: string; next: string; linear: string }> = [];

    // Graph-based projects
    const graphSlugs = await discoverGraphs(projectDir);
    for (const slug of graphSlugs) {
      try {
        const index = await loadIndex(projectDir, slug);
        const reqs = Object.values(index.requirements);
        const total = reqs.length;
        const complete = reqs.filter(r => r.status === 'complete').length;
        const ready = findReady(index);
        const next = isProjectComplete(index) ? '(done)' : ready.length > 0 ? ready[0] : '(blocked)';
        const linearState = index.linear?.projectId ? 'linked' : '-';
        rows.push({
          project: index.project,
          branch: index.branch,
          progress: `${complete}/${total}`,
          next,
          linear: linearState,
        });
      } catch {
        // skip invalid graphs
      }
    }

    if (rows.length === 0) {
      console.log('No projects found.');
      return;
    }

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
    const client = new ForgeLinearClient({ apiKey: requireApiKey() });
    const result = await client.createProject({
      name: opts.name,
      description: opts.description,
      teamIds: [opts.team],
      priority: opts.priority,
    });
    console.log(JSON.stringify(handleResult(result)));
  });

linear
  .command('create-milestone')
  .description('Create a milestone within a project')
  .requiredOption('--project <id>', 'Project ID')
  .requiredOption('--name <name>', 'Milestone name')
  .option('--description <desc>', 'Milestone description')
  .action(async (opts: { project: string; name: string; description?: string }) => {
    const client = new ForgeLinearClient({ apiKey: requireApiKey() });
    const result = await client.createMilestone({
      name: opts.name,
      description: opts.description,
      projectId: opts.project,
    });
    console.log(JSON.stringify(handleResult(result)));
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
    const client = new ForgeLinearClient({ apiKey: requireApiKey(), teamId: opts.team });
    const result = await client.createIssue({
      title: opts.title,
      description: opts.description,
      teamId: opts.team,
      projectId: opts.project,
      projectMilestoneId: opts.milestone,
      priority: opts.priority,
    });
    console.log(JSON.stringify(handleResult(result)));
  });

linear
  .command('create-issue-batch')
  .description('Create multiple issues in a batch')
  .requiredOption('--team <teamId>', 'Team ID')
  .requiredOption('--project <id>', 'Project ID')
  .requiredOption('--milestone <id>', 'Milestone ID')
  .requiredOption('--issues <json>', 'JSON array of issues [{title, description?, priority?}]')
  .action(async (opts: { team: string; project: string; milestone: string; issues: string }) => {
    const apiKey = requireApiKey();
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
    console.log(JSON.stringify(handleResult(result)));
  });

linear
  .command('create-project-relation')
  .description('Create a relation between two projects')
  .requiredOption('--project <id>', 'Project ID')
  .requiredOption('--related-project <id>', 'Related project ID')
  .requiredOption('--type <type>', 'Relation type (blocks|related)')
  .action(async (opts: { project: string; relatedProject: string; type: string }) => {
    const client = new ForgeLinearClient({ apiKey: requireApiKey() });
    const result = await client.createProjectRelation({
      projectId: opts.project,
      relatedProjectId: opts.relatedProject,
      type: opts.type,
    });
    console.log(JSON.stringify(handleResult(result)));
  });

linear
  .command('create-issue-relation')
  .description('Create a relation between two issues')
  .requiredOption('--issue <id>', 'Issue ID')
  .requiredOption('--related-issue <id>', 'Related issue ID')
  .requiredOption('--type <type>', 'Relation type (blocks|duplicate|related)')
  .action(async (opts: { issue: string; relatedIssue: string; type: string }) => {
    const apiKey = requireApiKey();
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
    console.log(JSON.stringify(handleResult(result)));
  });

// --- List commands ---

linear
  .command('list-teams')
  .description('List all Linear teams')
  .action(async () => {
    const client = new ForgeLinearClient({ apiKey: requireApiKey() });
    const teams = await client.listTeams();
    console.log(JSON.stringify(teams));
  });

linear
  .command('list-projects')
  .description('List projects for a team')
  .requiredOption('--team <teamId>', 'Team ID')
  .action(async (opts: { team: string }) => {
    const client = new ForgeLinearClient({ apiKey: requireApiKey() });
    const projects = await client.listProjects(opts.team);
    console.log(JSON.stringify(projects));
  });

linear
  .command('sync-planned')
  .description('Transition project to Planned after planning completes')
  .requiredOption('--slug <slug>', 'Graph slug')
  .action(async (opts: { slug: string }) => {
    const apiKey = requireApiKey();
    const projectDir = process.cwd();
    const index = await loadIndex(projectDir, opts.slug);
    if (!index.linear?.teamId) {
      console.error(JSON.stringify({ error: 'No Linear teamId in graph index' }));
      process.exit(1);
    }
    const client = new ForgeLinearClient({ apiKey, teamId: index.linear.teamId });
    const { syncGraphProjectPlanned } = await import('./linear/sync.js');
    const result = await syncGraphProjectPlanned(client, index);
    console.log(JSON.stringify(result));
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

program
  .command('codex-poll')
  .description('Poll GitHub PR for Codex review comments')
  .requiredOption('--owner <owner>', 'Repository owner')
  .requiredOption('--repo <repo>', 'Repository name')
  .requiredOption('--pr <number>', 'PR number')
  .action(async (opts: { owner: string; repo: string; pr: string }) => {
    const { pollForCodexReview } = await import('./codex-poll.js');
    await pollForCodexReview(opts);
  });

program.parse();
