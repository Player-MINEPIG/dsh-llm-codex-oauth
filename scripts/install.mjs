#!/usr/bin/env node
/**
 * Cross-platform no-pnpm installer: copy the plugin into the active module
 * resolution location and register its bundle. Works on Windows/macOS/Linux.
 *
 * Usage:
 *   node scripts/install.mjs             # installs into the "web" profile
 *   node scripts/install.mjs headless    # installs into another profile
 *
 * The script respects DSH_HOME and defaults to ~/.dsh. Re-running it refreshes
 * both script-managed installs and profile-local pnpm snapshots.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = 'dsh-llm-codex-oauth'
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
const PROFILE = process.argv[2] || 'web'
const CONTENT = ['src', 'dist', 'cordis.patch.yml', 'package.json']

if (!/^[A-Za-z0-9._-]+$/.test(PROFILE)) {
  console.error('error: profile may contain only letters, numbers, dot, underscore, and hyphen')
  process.exit(1)
}

const profileDir = join(DSH_HOME, 'profiles', PROFILE)
const pkgPath = join(profileDir, 'package.json')
if (!existsSync(pkgPath)) {
  console.error(`error: profile not found at ${profileDir}`)
  console.error(`start dsh ${PROFILE} once first (or set DSH_HOME)`)
  process.exit(1)
}
for (const item of CONTENT) {
  if (!existsSync(join(REPO, item))) {
    console.error(`error: ${item} missing from ${REPO}`)
    if (item === 'dist') console.error('run `node build.mjs` in the repo first')
    process.exit(1)
  }
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const profileLocal = join(profileDir, 'node_modules', PLUGIN)
const sharedLocal = join(DSH_HOME, 'profiles', 'node_modules', PLUGIN)
const profileOwnsPackage = existsSync(profileLocal)
  || Object.hasOwn(pkg.dependencies ?? {}, PLUGIN)
const dest = profileOwnsPackage ? profileLocal : sharedLocal
const shadow = profileOwnsPackage ? sharedLocal : profileLocal

function replacePluginDirectory(target) {
  const parent = dirname(target)
  const suffix = `${process.pid}-${Date.now()}`
  const staging = join(parent, `.${PLUGIN}.staging-${suffix}`)
  const backup = join(parent, `.${PLUGIN}.backup-${suffix}`)
  mkdirSync(parent, { recursive: true })
  mkdirSync(staging)

  try {
    for (const item of CONTENT) {
      cpSync(join(REPO, item), join(staging, item), { recursive: true })
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }

  let oldMoved = false
  try {
    if (existsSync(target)) {
      renameSync(target, backup)
      oldMoved = true
    }
    renameSync(staging, target)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (oldMoved && !existsSync(target)) renameSync(backup, target)
    throw error
  }

  if (oldMoved) {
    try {
      rmSync(backup, { recursive: true, force: true })
    } catch (error) {
      console.warn(`warning: refreshed plugin but could not remove backup ${backup}: ${error.message}`)
    }
  }
}

replacePluginDirectory(dest)

// A profile-local package wins Node resolution over profiles/node_modules.
// Once the active location is refreshed, remove the other copy so a future
// install-mode change cannot silently expose stale code.
if (shadow !== dest && existsSync(shadow)) {
  rmSync(shadow, { recursive: true, force: true })
  console.log(`removed shadowed stale copy ${shadow}`)
}

pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []
if (!pkg.dsh.profile.bundles.includes(PLUGIN)) pkg.dsh.profile.bundles.push(PLUGIN)
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

console.log(`installed ${PLUGIN} into profile "${PROFILE}" (no pnpm)`)
console.log(`active package path: ${dest}`)
console.log('OAuth credentials remain in DSH_HOME/.credentials.yaml and were not touched')
console.log(`restart dsh to load it: dsh ${PROFILE}  (or: npx @deepseek-ai/dsh ${PROFILE})`)
console.log(`\nuninstall: node scripts/uninstall.mjs ${PROFILE === 'web' ? '' : PROFILE}`)
