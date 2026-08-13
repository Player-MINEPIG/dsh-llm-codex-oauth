/**
 * Unit smoke test for dsh-llm-codex-oauth, run without booting dsh.
 * Resolves dependencies through the profile's node_modules.
 *
 * Surface covered: provider route, the /codex-oauth HTTP routes (status /
 * login / logout) against a stubbed webServer, the two read-only commands,
 * and the credential-store round-trip. No network is required.
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
const registered = { providers: [], adapters: [], commands: [], routes: [] }
const disposers = []

const webServer = {
  register(route) {
    registered.routes.push(route)
    return () => {}
  },
}

const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return () => {}
  },
  get(key) {
    return key === 'webServer' ? webServer : undefined
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
  },
  commands: {
    register(definition) { registered.commands.push(definition) },
  },
}

// ── HTTP route test harness ─────────────────────────────────────────────────
async function route(path) {
  const matched = registered.routes.find((r) => path.startsWith(r.path))
  if (matched === undefined) throw new Error(`no route for ${path}`)
  let body = null
  const req = {
    url: path,
    method: 'GET',
    on(event, callback) { if (event === 'end') queueMicrotask(callback) },
  }
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(payload) { body = typeof payload === 'string' ? JSON.parse(payload) : payload },
  }
  await matched.handler(req, res)
  return { status: res.statusCode, body }
}

// ── apply ────────────────────────────────────────────────────────────────────
console.log('plugin exports:', Object.keys(plugin).join(', '))
plugin.apply(ctx, { provider: 'codex-oauth', providerId: 'openai-codex', credentialRef: 'OPENAI_CODEX_OAUTH' })

// ── provider route ──────────────────────────────────────────────────────────
check('registered one provider route', registered.providers.length === 1 && registered.providers[0] === 'codex-oauth')
const adapter = registered.adapters[0]
check('adapter captured', adapter !== undefined)
const models = await adapter.listModels('codex-oauth')
check('listModels non-empty', Array.isArray(models) && models.length > 0, `${models.length} models`)

// ── HTTP routes ─────────────────────────────────────────────────────────────
check('web route registered', registered.routes.length === 1 && registered.routes[0].path === '/codex-oauth')

const signedOut = await route('/codex-oauth/status')
check('status 未登录', signedOut.status === 200 && signedOut.body.connected === false && signedOut.body.statusText === '未登录', signedOut.body.statusText)

// Seed a stored credential → connected state (no network).
credentialValues.set('OPENAI_CODEX_OAUTH', JSON.stringify({ type: 'oauth', access: 'a', refresh: 'r', expires: Date.now() + 60000, accountId: 'acct-1' }))
const connected = await route('/codex-oauth/status')
check('status connected', connected.status === 200 && connected.body.connected === true && connected.body.accountId === 'acct-1', connected.body.statusText)

const loginWhileConnected = await route('/codex-oauth/login')
check('login while connected returns connected', loginWhileConnected.body.connected === true && loginWhileConnected.body.accountId === 'acct-1')

const logout = await route('/codex-oauth/logout')
check('logout succeeds', logout.status === 200 && logout.body.connected === false)
check('logout deleted credential', credentialValues.get('OPENAI_CODEX_OAUTH') === undefined)
const afterLogout = await route('/codex-oauth/status')
check('status 未登录 after logout', afterLogout.body.connected === false)

const notFound = await route('/codex-oauth/nope')
check('unknown subpath 404', notFound.status === 404)

// ── commands: read-only helpers only ────────────────────────────────────────
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
const after = await store.modify('openai-codex', async () => ({ type: 'oauth', access: 'acc', refresh: 'ref', expires: 1, accountId: 'x' }))
const persisted = await store.read('openai-codex')
await store.delete('openai-codex')
check('credential store round-trip', before === undefined && after.access === 'acc' && persisted.refresh === 'ref' && (await store.read('openai-codex')) === undefined)

// ── cleanup ─────────────────────────────────────────────────────────────────
for (const dispose of disposers) {
  try { dispose() } catch {}
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
