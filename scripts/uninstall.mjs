#!/usr/bin/env node
/**
 * Cross-platform no-pnpm uninstaller: remove the plugin and drop its entries
 * from the profile manifest. Works on Windows / macOS / Linux.
 *
 * Usage:
 *   node scripts/uninstall.mjs             # uninstall from the "web" profile
 *   node scripts/uninstall.mjs headless    # uninstall from another profile
 *
 * This is the counterpart of scripts/install.mjs. If the plugin was installed
 * through `dsh plugin add` (pnpm), prefer the official removal:
 *   dsh plugin --profile <name> remove dsh-llm-codex-oauth
 * (this script still clears the manifest entries as a fallback).
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PLUGIN = 'dsh-llm-codex-oauth'
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILE = process.argv[2] || 'web'
const profileDir = join(DSH_HOME, 'profiles', PROFILE)

// 1. Remove the plugin directory from every node_modules location it can live in.
const locations = [
  join(DSH_HOME, 'profiles', 'node_modules', PLUGIN), // scripts/install.mjs location
  join(profileDir, 'node_modules', PLUGIN),           // pnpm-hoisted location
]
let removedAny = false
for (const location of locations) {
  if (existsSync(location)) {
    rmSync(location, { recursive: true, force: true })
    console.log(`removed ${location}`)
    removedAny = true
  }
}

// 2. Drop the bundle entry and the dependency spec from package.json.
const pkgPath = join(profileDir, 'package.json')
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  let changed = false

  const bundles = pkg.dsh?.profile?.bundles
  if (Array.isArray(bundles) && bundles.includes(PLUGIN)) {
    pkg.dsh.profile.bundles = bundles.filter((name) => name !== PLUGIN)
    changed = true
    console.log(`removed "${PLUGIN}" from dsh.profile.bundles`)
  }

  if (pkg.dependencies && PLUGIN in pkg.dependencies) {
    delete pkg.dependencies[PLUGIN]
    changed = true
    console.log(`removed "${PLUGIN}" from dependencies`)
  }

  if (changed) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

if (!removedAny) console.log(`${PLUGIN} was not found under the profile's node_modules`)

console.log(`restart dsh ${PROFILE} for the change to take effect`)
console.log(`if you installed via \`dsh plugin add\`, also run: dsh plugin --profile ${PROFILE} remove ${PLUGIN}`)
