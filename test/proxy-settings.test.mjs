import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ProxySettings } from '../src/proxy-settings.js'

function context() {
  let dispose
  return {
    ctx: { effect(callback) { dispose = callback() } },
    dispose() { dispose?.() },
  }
}

test('proxy settings can be toggled and persist across plugin restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-proxy-settings-'))
  const path = join(directory, 'settings.json')
  const first = context()
  try {
    const settings = new ProxySettings(first.ctx, 'http://127.0.0.1:7897', { path })
    assert.equal(settings.enabled, true)
    assert.equal(settings.proxyUrl, 'http://127.0.0.1:7897')
    settings.update({ enabled: false, proxyUrl: 'http://127.0.0.1:7897' })
    assert.equal(settings.enabled, false)
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
      enabled: false,
      proxyUrl: 'http://127.0.0.1:7897',
    })
  } finally {
    first.dispose()
  }

  const second = context()
  try {
    const settings = new ProxySettings(second.ctx, 'http://ignored.example:8080', { path })
    assert.equal(settings.enabled, false)
    assert.equal(settings.proxyUrl, 'http://127.0.0.1:7897')
    settings.update({ enabled: true, proxyUrl: 'http://127.0.0.1:7897' })
    assert.equal(settings.enabled, true)
  } finally {
    second.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})
