import { build } from 'esbuild';

// 1. Sandbox CLI (lean — runs inside sandbox, run command excluded)
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    './commands/run.js',    // run command not available inside sandbox
  ],
});

console.log('Build complete: dist/index.js (sandbox)');

// 2. Host CLI (full — runs on host machine, includes run command)
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/wanman.js',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    '@sandbank.dev/core',
    '@sandbank.dev/daytona',
  ],
});

console.log('Build complete: dist/wanman.js (host)');

await build({
  entryPoints: ['src/sdk.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/sdk.js',
  external: [
    '@sandbank.dev/core',
    '@sandbank.dev/daytona',
  ],
});

console.log('Build complete: dist/sdk.js (host sdk)');
