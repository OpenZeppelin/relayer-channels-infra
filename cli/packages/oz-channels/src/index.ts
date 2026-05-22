#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty';
import { version } from '../package.json';
import { agentDocsCommand } from './commands/agent-docs.js';
import { bootstrapCommand } from './commands/bootstrap/index.js';
import { channelsCommand } from './commands/channels.js';
import { completionsCommand } from './commands/completions.js';
import { feeCommand } from './commands/fee.js';
import { healthCommand } from './commands/health.js';
import { profileCommand } from './commands/profile.js';
import { smokeCommand } from './commands/smoke.js';
import { submitCommand } from './commands/submit.js';

const main = defineCommand({
  meta: {
    name: 'oz-channels',
    version,
    description: 'CLI for OpenZeppelin Channels plugin',
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
      description: 'Override channels URL',
    },
    'api-key': {
      type: 'string',
      description: 'Override API key',
    },
    'plugin-id': {
      type: 'string',
      description: 'Override plugin ID',
    },
    'admin-secret': {
      type: 'string',
      description: 'Override admin secret',
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
  },
  subCommands: {
    'agent-docs': agentDocsCommand,
    bootstrap: bootstrapCommand,
    channels: channelsCommand,
    completions: completionsCommand,
    fee: feeCommand,
    health: healthCommand,
    profile: profileCommand,
    smoke: smokeCommand,
    submit: submitCommand,
  },
});

runMain(main);
