import { build } from 'esbuild'

await build({
  entryPoints: ['src/client.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/client.js',
  // Client packages are resolved by the browser runtime's plugin inventory;
  // only React (and our own code) are inlined here.
  external: ['@deepseek-ai/*'],
  minify: false,
})
console.log('built dist/client.js')
