// esbuild.js — bundles the extension into a single dist/extension.js
// Keeps activation fast (no resolving hundreds of node_modules files at runtime)
// and keeps the .vsix package small.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'], // vscode module is provided by the host at runtime
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
};

async function run() {
  if (watch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('esbuild watching...');
  } else {
    await esbuild.build(config);
    console.log('esbuild build complete.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
