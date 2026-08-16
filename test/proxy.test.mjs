import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createCodexProxyFetch, installCodexProxy, shouldProxyCodexRequest } from '../src/proxy.js'

test('matches only the Codex OAuth and ChatGPT backend HTTPS origins', () => {
  assert.equal(shouldProxyCodexRequest('https://auth.openai.com/api/accounts/deviceauth/usercode'), true)
  assert.equal(shouldProxyCodexRequest(new URL('https://chatgpt.com/backend-api/codex/responses')), true)
  assert.equal(shouldProxyCodexRequest('https://api.openai.com/v1/models'), false)
  assert.equal(shouldProxyCodexRequest('http://auth.openai.com/unsafe'), false)
  assert.equal(shouldProxyCodexRequest('https://notchatgpt.com/'), false)
})

test('routes matching requests through the proxy and leaves all other fetches direct', async () => {
  const calls = []
  const fakeAgent = { destroy() { calls.push({ kind: 'destroy' }) } }
  const directFetch = async (input) => {
    calls.push({ kind: 'direct', input: String(input) })
    return new Response('direct')
  }
  const proxiedFetch = async (input, init) => {
    calls.push({ kind: 'proxy', input: String(input), agent: init.agent })
    return {
      body: Readable.from([Buffer.from('proxied')]),
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
    }
  }
  const proxy = createCodexProxyFetch('http://user:secret@127.0.0.1:7897', {
    directFetch,
    proxiedFetch,
    createAgent(url) {
      calls.push({ kind: 'agent', url: url.href })
      return fakeAgent
    },
  })

  assert.equal(proxy.displayUrl, 'http://127.0.0.1:7897')
  assert.equal(await (await proxy.fetch('https://auth.openai.com/test')).text(), 'proxied')
  assert.equal(await (await proxy.fetch('https://example.com/test')).text(), 'direct')
  assert.equal(calls.filter((call) => call.kind === 'proxy').length, 1)
  assert.equal(calls.find((call) => call.kind === 'proxy').agent, fakeAgent)
  assert.equal(calls.filter((call) => call.kind === 'direct').length, 1)
  proxy.close()
  assert.equal(calls.at(-1).kind, 'destroy')
})

test('rejects invalid and unsupported proxy URLs without exposing credentials', () => {
  assert.throws(() => createCodexProxyFetch('socks5://127.0.0.1:7897'), /must use http: or https:/)
  assert.throws(() => createCodexProxyFetch('not a URL'), /invalid proxyUrl/)
})

test('install restores the previous global fetch when the plugin is disposed', () => {
  const previous = globalThis.fetch
  let dispose
  const ctx = { effect(callback) { dispose = callback() } }
  const installed = installCodexProxy(ctx, 'http://127.0.0.1:7897')
  try {
    assert.equal(installed.enabled, true)
    assert.notEqual(globalThis.fetch, previous)
  } finally {
    dispose()
  }
  assert.equal(globalThis.fetch, previous)
})

test('proxy mode is disabled by default and leaves global fetch untouched', () => {
  const previous = globalThis.fetch
  const ctx = {
    effect() {
      throw new Error('disabled proxy must not register a disposer')
    },
  }
  const installed = installCodexProxy(ctx, undefined)
  assert.equal(installed.enabled, false)
  assert.equal(globalThis.fetch, previous)
})
