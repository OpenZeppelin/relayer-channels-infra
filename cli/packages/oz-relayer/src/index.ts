#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty';
import { version } from '../package.json';
import { agentDocsCommand } from './commands/agent-docs.js';
import { completionsCommand } from './commands/completions.js';
import { healthCommand } from './commands/health.js';
import { profileCommand } from './commands/profile.js';
import { relayerCommand } from './commands/relayer.js';
import { signerCommand } from './commands/signer.js';
import { txCommand } from './commands/tx.js';

const main = defineCommand({
  meta: {
    name: 'oz-relayer',
    version,
    description: 'CLI for managing OpenZeppelin Relayer',
  },
  args: {
    profile: {
      type: 'string',
      alias: 'p',
      description: 'Profile to use',
      default: 'default',
    },
    url: {
      type: 'string',
      description: 'Override relayer URL',
    },
    'api-key': {
      type: 'string',
      description: 'Override API key',
    },
    json: {
      type: 'boolean',
      description: 'Output as JSON',
      default: false,
    },
    'no-input': {
      type: 'boolean',
      description: 'Disable interactive prompts',
      default: false,
    },
    verbose: {
      type: 'boolean',
      alias: 'v',
      description: 'Verbose output (show full errors)',
      default: false,
    },
  },
  subCommands: {
    'agent-docs': agentDocsCommand,
    completions: completionsCommand,
    health: healthCommand,
    profile: profileCommand,
    relayer: relayerCommand,
    signer: signerCommand,
    tx: txCommand,
  },
});

runMain(main);
