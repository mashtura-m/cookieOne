// Bundles a Node app with esbuild. Workspace packages (@consentflow/*) are compiled in,
// everything else in "dependencies" stays external and is loaded from node_modules.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@consentflow/'));
const entries = process.argv.slice(2);

await build({
  entryPoints: entries,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist',
  external,
  sourcemap: true,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
console.log(`built ${entries.join(', ')} -> dist/`);
