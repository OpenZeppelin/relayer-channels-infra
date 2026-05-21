import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = import.meta.dir + '/..';
const DIST = join(ROOT, 'dist');

// Bundle the CLI
const result = await Bun.build({
  entrypoints: [join(ROOT, 'src/index.ts')],
  outdir: DIST,
  target: 'bun',
  format: 'esm',
});

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Bundled ${result.outputs.length} file(s)`);

// Copy static files
await cp(join(ROOT, 'src/shim.js'), join(DIST, 'shim.js'));
await cp(join(ROOT, 'AGENTS.md'), join(DIST, 'AGENTS.md'));

// Copy assets if they exist
try {
  await mkdir(join(DIST, 'assets'), { recursive: true });
  await cp(join(ROOT, 'src/assets'), join(DIST, 'assets'), { recursive: true });
} catch {
  // No assets to copy
}

console.log('Build complete');
