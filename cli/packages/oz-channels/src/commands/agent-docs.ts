import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineCommand } from 'citty';

export const agentDocsCommand = defineCommand({
  meta: {
    name: 'agent-docs',
    description: 'Output documentation for AI agents',
  },
  async run() {
    // Find AGENTS.md relative to the built output
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const agentsPath = join(__dirname, 'AGENTS.md');

    try {
      const content = readFileSync(agentsPath, 'utf-8');
      console.log(content);
    } catch {
      console.error('Error: AGENTS.md not found.');
      console.error('');
      console.error('The documentation file should be bundled with the CLI.');
      console.error('If you built from source, ensure AGENTS.md is copied to dist/');
      process.exit(1);
    }
  },
});
