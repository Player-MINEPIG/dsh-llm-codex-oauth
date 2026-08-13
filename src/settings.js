/**
 * Settings-section integration: login/logout live in the user-settings page
 * instead of the conversation. The section is a plain schema-driven form:
 *
 *   action          '' | login | logout   (user picks an operation)
 *   status          live status text
 *   verificationUrl device-flow URL while waiting for authorization
 *   userCode        device code while waiting for authorization
 *   accountId       connected ChatGPT account (when signed in)
 *   accessExpiresAt access-token expiry (when signed in)
 *
 * Picking an action starts/aborts the flow; LoginManager state transitions
 * write the read-only fields back into the form. Everything stays in the
 * host plane — no custom client bundle, no remote channel. Secret values
 * never appear here: only the device code, URL, account id and expiry.
 *
 * @module dsh-llm-codex-oauth/settings
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

const Config = z.object({
  action: z
    .union([z.const(''), z.const('login'), z.const('logout')])
    .description('选择操作：login 签发设备码开始登录；logout 登出并删除本地凭据'),
  status: z.string().description('当前状态'),
  verificationUrl: z.string().description('登录验证网址（等待授权时有效）'),
  userCode: z.string().description('设备码（等待授权时有效）'),
  accountId: z.string().description('已连接的 ChatGPT 账号'),
  accessExpiresAt: z.string().description('access token 到期时间（UTC ISO，过期自动续期）'),
})

/** Map a LoginManager state to the form's read-only fields. */
function stateToFields(state) {
  switch (state?.status) {
    case 'starting':
      return { status: '登录启动中…' }
    case 'pending':
      return {
        status: `等待授权：请在浏览器打开 ${state.verificationUri}，输入设备码 ${state.userCode}`,
        verificationUrl: state.verificationUri ?? '',
        userCode: state.userCode ?? '',
      }
    case 'complete':
      return {
        status: `已连接${state.accountId !== undefined ? `（账号 ${state.accountId}）` : ''}`,
        accountId: state.accountId ?? '',
        verificationUrl: '',
        userCode: '',
        accessExpiresAt: state.expiresAt !== undefined ? new Date(state.expiresAt).toISOString() : '',
      }
    case 'failed':
      return { status: `登录失败：${state.message ?? ''}`, verificationUrl: '', userCode: '' }
    case 'cancelled':
      return { status: '已取消' }
    case 'signed-out':
      return { status: '未登录', accountId: '', verificationUrl: '', userCode: '', accessExpiresAt: '' }
    default:
      return { status: '未登录' }
  }
}

/**
 * Register the settings section and wire actions/lifecycle into it.
 * @param ctx - plugin Context (settings service mounted by the base composition).
 * @param login - LoginManager instance.
 * @param store - DshCredentialStore instance.
 * @param provider - dsh provider route this section belongs to (shown as base value).
 * @param providerId - pi-ai catalog provider id the store serves.
 * @param nsName - settings namespace id, e.g. "llm-codex-oauth".
 */
export function installCodexSettings(ctx, login, store, provider, providerId, nsName) {
  const NS = settingsNamespace(nsName)
  const scope = ctx.settings.register(NS, Config, { base: { provider } })

  const push = (patch) => {
    scope.update(patch).catch(() => {})
  }

  // Form action handling: login starts the device flow; logout tears down.
  // Clear the action before touching the flow, and guard re-entrancy, so a
  // state push that re-enters the watcher (synchronous settings providers)
  // cannot restart the flow.
  let handling = false
  scope.watch(() => {
    if (handling) return
    const action = scope.get().action ?? ''
    if (action !== 'login' && action !== 'logout') return
    handling = true
    try {
      push({ action: '' })
      if (action === 'login') login.start()
      else login.logout().catch(() => {})
    } finally {
      handling = false
    }
  })

  // Login lifecycle → read-only form fields.
  login.onState((state) => push(stateToFields(state)))

  // Initial sync: a stored credential means the form opens in "connected".
  store.read(providerId).then((credential) => {
    if (credential !== undefined) {
      push(stateToFields({ status: 'complete', accountId: credential.accountId, expiresAt: credential.expires }))
    }
  }).catch(() => {})
}
