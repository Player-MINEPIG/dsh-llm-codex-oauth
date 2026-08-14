import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const installer = path.join(repo, 'scripts', 'install.mjs')
const plugin = 'dsh-llm-codex-oauth'

async function makeProfile(home, pkg = {}) {
  const profile = path.join(home, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), `${JSON.stringify({
    name: 'test-profile',
    private: true,
    ...pkg,
  }, null, 2)}\n`)
  return profile
}

function install(home, profile = 'web') {
  return spawnSync(process.execPath, [installer, profile], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home },
  })
}

test('repeated script install refreshes the shared package and preserves credentials', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'codex-oauth-install-'))
  try {
    const profile = await makeProfile(home)
    const credentials = path.join(home, '.credentials.yaml')
    await writeFile(credentials, 'test-owned-sentinel')

    const first = install(home)
    assert.equal(first.status, 0, first.stderr)
    const target = path.join(home, 'profiles', 'node_modules', plugin)
    const installedIndex = path.join(target, 'src', 'index.js')
    assert.equal(await readFile(installedIndex, 'utf8'), await readFile(path.join(repo, 'src', 'index.js'), 'utf8'))

    await writeFile(installedIndex, 'stale snapshot')
    const second = install(home)
    assert.equal(second.status, 0, second.stderr)
    assert.equal(await readFile(installedIndex, 'utf8'), await readFile(path.join(repo, 'src', 'index.js'), 'utf8'))
    assert.equal(await readFile(credentials, 'utf8'), 'test-owned-sentinel')

    const manifest = JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8'))
    assert.equal(manifest.dsh.profile.bundles.filter((name) => name === plugin).length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('pnpm-managed profile refreshes its higher-priority local package', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'codex-oauth-pnpm-refresh-'))
  try {
    const profile = await makeProfile(home, {
      dependencies: { [plugin]: 'file:/old/source' },
    })
    const profileLocal = path.join(profile, 'node_modules', plugin)
    const sharedLocal = path.join(home, 'profiles', 'node_modules', plugin)
    await mkdir(path.join(profileLocal, 'src'), { recursive: true })
    await mkdir(path.join(sharedLocal, 'src'), { recursive: true })
    await writeFile(path.join(profileLocal, 'src', 'index.js'), 'stale pnpm snapshot')
    await writeFile(path.join(sharedLocal, 'src', 'index.js'), 'shadowed duplicate')

    const result = install(home)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      await readFile(path.join(profileLocal, 'src', 'index.js'), 'utf8'),
      await readFile(path.join(repo, 'src', 'index.js'), 'utf8'),
    )
    await assert.rejects(readFile(path.join(sharedLocal, 'src', 'index.js'), 'utf8'), /ENOENT/)

    const manifest = JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8'))
    assert.equal(manifest.dependencies[plugin], 'file:/old/source')
    assert.equal(manifest.dsh.profile.bundles.includes(plugin), true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('rejects profile path traversal', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'codex-oauth-profile-'))
  try {
    const result = install(home, '../escape')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /profile may contain only/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
