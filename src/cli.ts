#!/usr/bin/env node
import { program } from 'commander';
import { loadConfig } from './config/loader.js';
import { registerGate, runPipeline } from './gates/index.js';
import { typesGate } from './gates/types-gate.js';
import { lintGate } from './gates/lint-gate.js';
import { testsGate } from './gates/tests-gate.js';
import { writeVerifyCache } from './state/cache.js';
import { readStatus, discoverStatuses, findNextPending } from './state/status.js';
import { ForgeLinearClient } from './linear/client.js';
import { syncMilestoneStart, syncMilestoneComplete, syncProjectDone } from './linear/sync.js';

program
  .name('forge')
  .version('1.0.0')
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

const linearSync = program
  .command('linear-sync')
  .description('Sync milestone state with Linear');

linearSync
  .command('start')
  .description('Start a milestone sync')
  .requiredOption('--slug <slug>', 'PRD slug')
  .requiredOption('--milestone <n>', 'Milestone number')
  .action(async (opts: { slug: string; milestone: string }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) return;
    try {
      const projectDir = process.cwd();
      const status = await readStatus(projectDir, opts.slug);
      if (!status.linearTeamId) return;
      const client = new ForgeLinearClient({ apiKey, teamId: status.linearTeamId });
      const config = await loadConfig(projectDir);
      await syncMilestoneStart(client, config, status, opts.milestone);
    } catch (err) {
      console.warn('[forge] linear-sync start failed:', err);
    }
  });

linearSync
  .command('complete')
  .description('Complete a milestone sync')
  .requiredOption('--slug <slug>', 'PRD slug')
  .requiredOption('--milestone <n>', 'Milestone number')
  .option('--last', 'This is the last milestone')
  .option('--pr-url <url>', 'PR URL to include in comments')
  .action(async (opts: { slug: string; milestone: string; last?: boolean; prUrl?: string }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) return;
    try {
      const projectDir = process.cwd();
      const status = await readStatus(projectDir, opts.slug);
      if (!status.linearTeamId) return;
      const client = new ForgeLinearClient({ apiKey, teamId: status.linearTeamId });
      const config = await loadConfig(projectDir);
      await syncMilestoneComplete(client, config, status, opts.milestone, !!opts.last);
    } catch (err) {
      console.warn('[forge] linear-sync complete failed:', err);
    }
  });

linearSync
  .command('done')
  .description('Mark project as done in Linear')
  .requiredOption('--slug <slug>', 'PRD slug')
  .action(async (opts: { slug: string }) => {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) return;
    try {
      const projectDir = process.cwd();
      const status = await readStatus(projectDir, opts.slug);
      if (!status.linearTeamId) return;
      const client = new ForgeLinearClient({ apiKey, teamId: status.linearTeamId });
      const config = await loadConfig(projectDir);
      await syncProjectDone(client, config, status);
    } catch (err) {
      console.warn('[forge] linear-sync done failed:', err);
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
