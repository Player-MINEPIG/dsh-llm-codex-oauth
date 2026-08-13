/**
 * Host HTTP routes for the settings-panel client half.
 *
 * Uses the dsh web server service (`ctx.webServer`, mounted by the web app
 * bundle) to expose three same-origin endpoints the browser client calls:
 *
 *   GET  /codex-oauth/status   → login status + pending device-code fields
 *   POST /codex-oauth/login    → start the device-code flow (returns first state)
 *   POST /codex-oauth/logout   → abort + delete the stored credential
 *
 * This is the third-party client↔host channel (no typert remotes, no
 * whitelist). Responses are JSON only; no token ever leaves the host.
 *
 * @module dsh-llm-codex-oauth/server
 */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1_000_000) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (data === '') return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** Map LoginManager state + stored credential to the client-facing payload. */
function statusPayload(state, credential) {
  if (credential !== undefined) {
    return {
      ok: true,
      connected: true,
      accountId: typeof credential.accountId === 'string' ? credential.accountId : '',
      expiresAt: credential.expires,
      statusText: `已连接 ChatGPT 账号${typeof credential.accountId === 'string' && credential.accountId ? `（${credential.accountId}）` : ''}`,
    }
  }
  switch (state?.status) {
    case 'starting':
      return { ok: true, connected: false, statusText: '登录启动中…' }
    case 'pending':
      return {
        ok: true,
        connected: false,
        statusText: '等待授权',
        verificationUrl: state.verificationUri ?? '',
        userCode: state.userCode ?? '',
      }
    case 'failed':
      return { ok: true, connected: false, statusText: `登录失败：${state.message ?? ''}` }
    default:
      return { ok: true, connected: false, statusText: '未登录' }
  }
}

/**
 * Register the /codex-oauth route prefix. No-op when the web server service is
 * absent (e.g. a headless profile), so the plugin keeps working there.
 * @returns the route disposer, or undefined when there is no web server.
 */
export function installServerRoutes(ctx, login, store, providerId) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return undefined

  return webServer.register({
    kind: 'prefix',
    path: '/codex-oauth',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.pathname

        if (path === '/codex-oauth/status') {
          const credential = await store.read(providerId)
          return sendJson(res, 200, statusPayload(login.state, credential))
        }

        if (path === '/codex-oauth/login') {
          const credential = await store.read(providerId)
          if (credential !== undefined) {
            return sendJson(res, 200, statusPayload(undefined, credential))
          }
          login.start()
          const state = await login.waitState(30000)
          return sendJson(res, 200, statusPayload(state, undefined))
        }

        if (path === '/codex-oauth/logout') {
          await login.logout()
          return sendJson(res, 200, { ok: true, connected: false, statusText: '未登录' })
        }

        return sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}
