#!/usr/bin/env node
import { program } from 'commander';

program
  .name('forge')
  .version('1.0.0')
  .description('Forge — verification harness for Claude Code agents');

program
  .command('verify')
  .description('Run verification gates')
  .action(() => {
    console.log('Not yet implemented');
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
