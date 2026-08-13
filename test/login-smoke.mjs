/**
 * Live smoke test for the device-code login flow: starts the flow against
 * auth.openai.com, waits for the device_code notify (no user interaction
 * needed for that step), then aborts before any user authorization.
 * Nothing is persisted.
 */
import { createModels } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { DshCredentialStore } from 'dsh-llm-codex-oauth/src/store.js'

const ctx = {
  credentials: {
    async resolve() { return undefined },
    async set() {},
    async unset() {},
  },
}
const store = new DshCredentialStore(ctx, 'OPENAI_CODEX_OAUTH', 'openai-codex')
const models = createModels({ credentials: store })
const codex = builtinProviders().find((p) => p.id === 'openai-codex')
models.setProvider(codex)

const controller = new AbortController()
let notified

const interaction = {
  signal: controller.signal,
  prompt: async (p) => {
    if (p.type === 'select') return 'device_code'
    throw new Error(`unexpected prompt: ${p.type}`)
  },
  notify: (event) => { notified = event },
}

const loginPromise = models.login('openai-codex', 'oauth', interaction).then(
  () => { console.log('UNEXPECTED: login completed without user authorization') },
  (error) => {
    if (controller.signal.aborted) console.log('aborted as expected:', String(error?.message ?? error).slice(0, 80))
    else console.error('FAIL: login errored without abort:', String(error?.message ?? error).slice(0, 200))
  },
)

const deadline = Date.now() + 30000
while (notified === undefined && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 250))
}
if (notified === undefined) {
  console.error('FAIL: no device_code notify within 30s')
  process.exit(1)
}
if (notified.type !== 'device_code') {
  console.error('FAIL: unexpected notify type', notified.type)
  process.exit(1)
}
console.log('device flow started:')
console.log('  verificationUri:', notified.verificationUri)
console.log('  userCode len:', notified.userCode.length, '(value hidden)')
console.log('  intervalSeconds:', notified.intervalSeconds, '| expiresInSeconds:', notified.expiresInSeconds)

controller.abort()
await loginPromise
console.log('login smoke passed (flow started, cancelled before user authorization)')
