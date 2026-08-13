/**
 * Conversation-side read-only helpers: /codex-status and /codex-logout.
 *
 * Login itself lives in the settings page (see settings.js) — users do not
 * register from the conversation. These two commands stay as conveniences:
 * both are read-only against the credential store (logout only deletes the
 * stored credential; it never starts a flow). No handler ever prints a token.
 *
 * @module dsh-llm-codex-oauth/commands
 */

export function installCommands(ctx, login, store, providerId) {
  ctx.commands.register({
    name: 'codex-status',
    description: '查看 Codex 订阅登录状态',
    input: { hint: '直接按回车查看状态（无需参数）' },
    async handler() {
      const pending = login.state
      if (pending?.status === 'pending') {
        return {
          kind: 'success',
          text: `等待授权：请在浏览器打开 ${pending.verificationUri}，输入设备码 ${pending.userCode}。`,
        }
      }
      const credential = await store.read(providerId)
      if (credential !== undefined) {
        const account = typeof credential.accountId === 'string' && credential.accountId.length > 0 ? credential.accountId : '(未记录)'
        return {
          kind: 'success',
          text: `已连接 ChatGPT 账号 ${account}。access token 有效期至 ${new Date(credential.expires).toISOString()}，过期后会自动用 refresh token 续期。`,
        }
      }
      if (pending?.status === 'failed') {
        return { kind: 'error', text: `上次登录失败：${pending.message}` }
      }
      return { kind: 'success', text: '未登录。请到设置页的 Codex 订阅区块登录。' }
    },
  })

  ctx.commands.register({
    name: 'codex-logout',
    description: '登出 ChatGPT 账号并删除本地 OAuth 凭据',
    input: { hint: '直接按回车确认登出（无需参数）' },
    async handler() {
      await login.logout()
      return { kind: 'success', text: '已登出，本地 OAuth 凭据已删除。' }
    },
  })
}
