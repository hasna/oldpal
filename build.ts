#!/usr/bin/env bun
/**
 * Build script for oldpal CLI
 * Bundles the terminal app into a single distributable file
 */

import { $ } from 'bun';

const outdir = './dist';

console.log('Building oldpal...');

// Clean dist
await $`rm -rf ${outdir}`;
await $`mkdir -p ${outdir}`;

// Bundle with Bun
const result = await Bun.build({
  entrypoints: ['./packages/terminal/src/index.tsx'],
  outdir,
  target: 'bun',
  format: 'esm',
  minify: false, // Keep readable for debugging
  sourcemap: 'external',
  // Stub out react-devtools-core to avoid window reference errors
  plugins: [
    {
      name: 'stub-devtools',
      setup(build) {
        // Replace react-devtools-core imports with a no-op
        build.onResolve({ filter: /^react-devtools-core$/ }, () => {
          return {
            path: 'react-devtools-core',
            namespace: 'stub',
          };
        });
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => {
          return {
            contents: 'export default { connectToDevTools: () => {} };',
            loader: 'js',
          };
        });
      },
    },
  ],
});

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Add shebang to the output if not present
const outputFile = `${outdir}/index.js`;
const content = await Bun.file(outputFile).text();
if (!content.startsWith('#!/usr/bin/env bun')) {
  await Bun.write(outputFile, `#!/usr/bin/env bun\n${content}`);
}

// Make executable
await $`chmod +x ${outputFile}`;

// Copy skills directory
await $`cp -r .oldpal ${outdir}/.oldpal 2>/dev/null || true`;

// Copy config directory
await $`cp -r config ${outdir}/config 2>/dev/null || true`;

console.log('Build complete! Output in ./dist');
console.log('Files:');
await $`ls -la ${outdir}`;
