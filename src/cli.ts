#!/usr/bin/env node
import { program } from 'commander';
import { loadConfig } from './config/loader.js';
import { registerGate, runPipeline } from './gates/index.js';
import { typesGate } from './gates/types-gate.js';
import { lintGate } from './gates/lint-gate.js';
import { testsGate } from './gates/tests-gate.js';
import { writeVerifyCache } from './state/cache.js';

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
  .action(() => {
    console.log('Not yet implemented');
  });

program
  .command('status')
  .description('Show PRD progress')
  .action(() => {
    console.log('Not yet implemented');
  });

program
  .command('setup')
  .description('Initialize forge for a project')
  .action(() => {
    console.log('Not yet implemented');
  });

const linearSync = program
  .command('linear-sync')
  .description('Sync milestone state with Linear');

linearSync
  .command('start')
  .description('Start a milestone sync')
  .action(() => {
    console.log('Not yet implemented');
  });

linearSync
  .command('complete')
  .description('Complete a milestone sync')
  .action(() => {
    console.log('Not yet implemented');
  });

linearSync
  .command('done')
  .description('Mark milestone sync as done')
  .action(() => {
    console.log('Not yet implemented');
  });

program
  .command('doctor')
  .description('Check environment')
  .action(() => {
    console.log('Not yet implemented');
  });

program
  .command('update')
  .description('Update forge to latest version')
  .action(() => {
    console.log('Not yet implemented');
  });

program.parse();
