#!/usr/bin/env node
/**
 * Cross-platform no-pnpm installer: copy the plugin into the profile's
 * node_modules and register its bundle. Works on Windows / macOS / Linux.
 *
 * Usage:
 *   node scripts/install.mjs             # installs into the "web" profile
 *   node scripts/install.mjs headless    # installs into another profile
 *
 * The script respects the DSH_HOME environment variable and defaults to
 * ~/.dsh (the same root dsh itself uses on every platform).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = 'dsh-llm-codex-oauth'
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILE = process.argv[2] || 'web'
const profileDir = join(DSH_HOME, 'profiles', PROFILE)
const nodeModules = join(DSH_HOME, 'profiles', 'node_modules')

if (!existsSync(join(profileDir, 'package.json'))) {
  console.error(`error: profile not found at ${profileDir}`)
  console.error(`start dsh ${PROFILE} once first (or set DSH_HOME)`)
  process.exit(1)
}
if (!existsSync(join(REPO, 'dist', 'client.js'))) {
  console.error('error: dist/client.js missing — run `node build.mjs` in the repo first')
  process.exit(1)
}

const dest = join(nodeModules, PLUGIN)
mkdirSync(nodeModules, { recursive: true })
rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
for (const item of ['src', 'dist', 'cordis.patch.yml', 'package.json']) {
  cpSync(join(REPO, item), join(dest, item), { recursive: true })
}

const pkgPath = join(profileDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []
if (!pkg.dsh.profile.bundles.includes(PLUGIN)) pkg.dsh.profile.bundles.push(PLUGIN)
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

console.log(`installed ${PLUGIN} into profile "${PROFILE}" (no pnpm)`)
console.log(`restart dsh to load it: dsh ${PROFILE}  (or: npx @deepseek-ai/dsh ${PROFILE})`)
console.log(`\nuninstall: delete "${dest}" and remove "${PLUGIN}" from dsh.profile.bundles in "${pkgPath}", then restart.`)
