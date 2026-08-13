/**
 * Unit smoke test for dsh-llm-codex-oauth, run without booting dsh.
 * Resolves dependencies through the profile's node_modules.
 *
 * Surface covered: provider route + configurable-provider directory entry,
 * settings section registration and the action-driven login/logout flow
 * (with a stubbed settings scope), the two read-only commands, and the
 * credential-store round-trip. No network is required for the assertions;
 * the login action only starts the device flow in the background.
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
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

// ── stub dsh Context ────────────────────────────────────────────────────────
const credentialValues = new Map()
const registered = { providers: [], adapters: [], directory: [], commands: [], settings: [] }
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
    async set(ref, value) { credentialValues.set(String(ref), value) },
    async unset(ref) { credentialValues.delete(String(ref)) },
  },
  llm: {
    registerAdapter(providers, adapter) {
      registered.providers.push(...providers)
      registered.adapters.push(adapter)
      const handle = () => {}
      handle.replace = () => {}
      return handle
    },
    registerConfigurableProviders(entries) {
      registered.directory.push(...entries)
      const handle = () => {}
      handle.replace = () => {}
      return handle
    },
  },
  commands: {
    register(definition) { registered.commands.push(definition) },
  },
  settings: {
    register(ns, schema, options) {
      const doc = {}
      const watchers = []
      const scope = {
        get: () => ({ action: '', status: '', ...doc }),
        watch(callback) { watchers.push(callback) },
        async update(patch) {
          Object.assign(doc, patch)
          // The real provider commits the document and then emits; mirror that.
          for (const callback of [...watchers]) callback()
        },
      }
      registered.settings.push({ ns, schema, options, scope, watchers, doc })
      return scope
    },
  },
}

// ── apply ────────────────────────────────────────────────────────────────────
console.log('plugin exports:', Object.keys(plugin).join(', '))
plugin.apply(ctx, {
  provider: 'codex-oauth', providerId: 'openai-codex', credentialRef: 'OPENAI_CODEX_OAUTH',
  settingsNs: 'llm-codex-oauth',
})

// ── provider route + directory ──────────────────────────────────────────────
check('registered one provider route', registered.providers.length === 1 && registered.providers[0] === 'codex-oauth')
const adapter = registered.adapters[0]
check('adapter captured', adapter !== undefined)
check('providerInfo preserves id', adapter.providerInfo('codex-oauth').id === 'codex-oauth')

const directory = registered.directory.find((entry) => entry.provider === 'codex-oauth')
check('configurable-provider directory entry', directory !== undefined && directory.settingsNs === 'llm-codex-oauth' && Array.isArray(directory.settingsPath) && directory.settingsPath.length === 0 && typeof directory.displayName === 'string' && directory.displayName.length > 0, directory?.displayName)

const models = await adapter.listModels('codex-oauth')
check('listModels non-empty', Array.isArray(models) && models.length > 0, `${models.length} models`)
const resolved = await adapter.resolveModel('codex-oauth', models[0].id)
check('resolveModel context', typeof resolved.context?.contextWindow === 'number' && resolved.context.contextWindow > 0)

// ── settings section ────────────────────────────────────────────────────────
const settingsEntry = registered.settings.find((entry) => String(entry.ns) === 'llm-codex-oauth')
check('settings namespace registered', settingsEntry !== undefined)
check('settings schema registered (schemastery fn)', settingsEntry !== undefined && typeof settingsEntry.schema === 'function')
await tick()
check('initial status pushed to 未登录', settingsEntry?.doc.status === '未登录', settingsEntry?.doc.status)

// login action: user picks 登录 in the form.
await settingsEntry.scope.update({ action: 'login' })
check('login action resets after handling', settingsEntry.doc.action === '')
check('login flow started (state starting)', settingsEntry.doc.status === '登录启动中…', settingsEntry.doc.status)
// The device flow now runs in the background against auth.openai.com;
// give it a moment, then log out (also aborts the in-flight flow).
await new Promise((resolve) => setTimeout(resolve, 500))
await settingsEntry.scope.update({ action: 'logout' })
await tick()
check('logout marks 未登录', settingsEntry.doc.status === '未登录' || settingsEntry.doc.status === '已取消', settingsEntry.doc.status)
check('logout clears account fields', settingsEntry.doc.accountId === '' && settingsEntry.doc.verificationUrl === '')

// ── commands: read-only helpers only, no conversation-side login ───────────
const names = registered.commands.map((c) => c.name).sort()
check('commands are status+logout only', JSON.stringify(names) === JSON.stringify(['codex-logout', 'codex-status']), names.join(', '))
check('no conversation-side login command', !registered.commands.some((c) => c.name === 'codex-login'))
const statusDef = registered.commands.find((c) => c.name === 'codex-status')
const result = await statusDef.handler({})
check('codex-status points to settings page when 未登录', result.kind === 'success' && /设置页/.test(result.text ?? ''), result.text)

// ── credential store round-trip ─────────────────────────────────────────────
const { DshCredentialStore } = await import('dsh-llm-codex-oauth/src/store.js')
const store = new DshCredentialStore(ctx, 'OPENAI_CODEX_OAUTH', 'openai-codex')
const before = await store.read('openai-codex')
const after = await store.modify('openai-codex', async () => ({
  type: 'oauth', access: 'acc-token', refresh: 'ref-token', expires: 12345, accountId: 'acct-1',
}))
const persisted = await store.read('openai-codex')
const listed = await store.list()
await store.delete('openai-codex')
const gone = await store.read('openai-codex')
check('credential store round-trip', before === undefined && after.access === 'acc-token' && persisted.refresh === 'ref-token' && listed.length === 1 && gone === undefined)

// ── cleanup ─────────────────────────────────────────────────────────────────
for (const dispose of disposers) {
  try { dispose() } catch {}
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
