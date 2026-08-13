/**
 * Unit smoke test for dsh-llm-codex-oauth, run without booting dsh.
 * Resolves dependencies through the profile's hoisted node_modules.
 */
import * as plugin from 'dsh-llm-codex-oauth'

let failed = 0
function check(label, ok, detail = '') {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failed += 1
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── stub dsh Context ────────────────────────────────────────────────────────
const credentialValues = new Map()
const registered = { providers: [], adapters: [], commands: [] }
const disposers = []

const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return () => {}
  },
  credentials: {
    async resolve(ref) {
      const value = credentialValues.get(String(ref))
      return value === undefined ? undefined : { value, source: 'memory' }
    },
    async set(ref, value) {
      credentialValues.set(String(ref), value)
    },
    async unset(ref) {
      credentialValues.delete(String(ref))
    },
  },
  llm: {
    registerAdapter(providers, adapter) {
      registered.providers.push(...providers)
      registered.adapters.push(adapter)
      const handle = () => {}
      handle.replace = () => {}
      return handle
    },
  },
  commands: {
    register(definition) {
      registered.commands.push(definition)
    },
  },
}

// ── apply ────────────────────────────────────────────────────────────────────
console.log('plugin exports:', Object.keys(plugin).join(', '))
plugin.apply(ctx, { provider: 'codex-oauth', providerId: 'openai-codex', credentialRef: 'OPENAI_CODEX_OAUTH' })

check('registered one provider route', registered.providers.length === 1 && registered.providers[0] === 'codex-oauth')
const adapter = registered.adapters[0]
check('adapter captured', adapter !== undefined)

const info = adapter.providerInfo('codex-oauth')
check('providerInfo preserves id', info.id === 'codex-oauth')
check('providerInfo name', typeof info.name === 'string' && info.name.length > 0, info.name)

const models = await adapter.listModels('codex-oauth')
check('listModels non-empty', Array.isArray(models) && models.length > 0, `${models.length} models`)
check('listModels carries provider', models.every((m) => m.provider === 'codex-oauth'))
const modelIds = models.map((m) => m.id)
console.log('  catalog:', modelIds.join(', '))

for (const id of modelIds.slice(0, 3)) {
  const resolved = await adapter.resolveModel('codex-oauth', id)
  check(`resolveModel(${id}) context`, typeof resolved.context?.contextWindow === 'number' && resolved.context.contextWindow > 0, `ctx=${resolved.context?.contextWindow}`)
  if (resolved.reasoning?.efforts?.length) console.log(`    reasoning(${id}):`, resolved.reasoning.efforts.map((e) => e.id).join(','))
}

// unknown model
let unknownOk = false
try {
  await adapter.resolveModel('codex-oauth', 'no-such-model-xyz')
} catch (error) {
  unknownOk = String(error.message).includes('UNKNOWN_MODEL') || String(error.code).includes('UNKNOWN_MODEL') || /no configured model/.test(String(error.message))
}
check('unknown model rejects', unknownOk)

// ── credential store round-trip ─────────────────────────────────────────────
const storeRoundTrip = async () => {
  const mod = await import('dsh-llm-codex-oauth/src/store.js')
  const store = new mod.DshCredentialStore(ctx, 'OPENAI_CODEX_OAUTH', 'openai-codex')
  const before = await store.read('openai-codex')
  const after = await store.modify('openai-codex', async () => ({
    type: 'oauth', access: 'acc-token', refresh: 'ref-token', expires: 12345, accountId: 'acct-1',
  }))
  const persisted = await store.read('openai-codex')
  const listed = await store.list()
  await store.delete('openai-codex')
  const gone = await store.read('openai-codex')
  return (
    before === undefined
    && after.access === 'acc-token'
    && persisted.refresh === 'ref-token'
    && listed.length === 1 && listed[0].providerId === 'openai-codex'
    && gone === undefined
    && typeof credentialValues.get('OPENAI_CODEX_OAUTH') === 'undefined'
  )
}
check('credential store round-trip (read/modify/list/delete)', await storeRoundTrip())

// ── commands ─────────────────────────────────────────────────────────────────
const names = registered.commands.map((c) => c.name).sort()
check('commands registered', JSON.stringify(names) === JSON.stringify(['codex-login', 'codex-logout', 'codex-status']), names.join(', '))
check('handlers are functions', registered.commands.every((c) => typeof c.handler === 'function'))

// status command without credential
const statusDef = registered.commands.find((c) => c.name === 'codex-status')
const result = await statusDef.handler({})
check('codex-status returns 未登录 without credential', result.kind === 'success' && /未登录/.test(result.text ?? ''), result.text)

// ── cleanup ──────────────────────────────────────────────────────────────────
for (const dispose of disposers) {
  try { dispose() } catch {}
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
