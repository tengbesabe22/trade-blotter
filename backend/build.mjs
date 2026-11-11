import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageDirectory = fileURLToPath(new URL('.', import.meta.url));

// Remove stale files from the previous compiler output before creating the bundle.
await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true });

await build({
  absWorkingDir: packageDirectory,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external', // Keep npm/workspace packages, including Prisma, as runtime dependencies.
  sourcemap: true,
});
