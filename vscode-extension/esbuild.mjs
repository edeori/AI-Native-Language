import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  banner: {
    js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
  define: {
    'import.meta.url': '__importMetaUrl',
  },
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  console.log('watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
