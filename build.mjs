import { build } from 'esbuild'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

const id = 'dsh-llm-codex-oauth'

// 1. Bundle the client half to CommonJS. `react` and `@deepseek-ai/*` stay
//    external: the factory's module-system `require` resolves them from the
//    shell's module table (react is a provided seed word — bundling our own
//    copy would break hooks against the shell's renderer).
await build({
  entryPoints: ['src/client.js'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/client.cjs',
  minify: false,
  external: ['react', '@deepseek-ai/*'],
})

// 2. Wrap the CJS body in the dsh client-modules factory handoff. The bundle
//    is loaded as a classic <script>, so it must register itself:
//    window.__ModuleLoader__.load({ id, factory }). The factory receives the
//    module-system `require` and returns `module.exports` (the client plugin
//    exports: name/inject/apply).
const body = readFileSync('dist/client.cjs', 'utf8')
const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(id)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
\t\treturn module.exports;
\t}
});
`
writeFileSync('dist/client.js', wrapped)
// The .cjs is only an intermediate for wrapping; keep the published dist clean.
rmSync('dist/client.cjs')
console.log('built dist/client.js (client-modules factory format)')
