/**
 * /codex-login, /codex-status, /codex-logout command handlers.
 *
 * Commands run on the host plane (the dsh base composition mounts the command
 * registry) and their results render directly in the conversation UI — they
 * never enter model history. No handler ever prints a token: only the
 * verification URL, the device code, the account id, and expiry times.
 *
 * @module dsh-llm-codex-oauth/commands
 */

function minutesText(seconds) {
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`
}

export function installCommands(ctx, login, store, providerId) {
  ctx.commands.register({
    name: 'codex-login',
    description: '用 ChatGPT 账号登录（设备码），启用 Codex 订阅模型',
    async handler() {
      const existing = await store.read(providerId)
      if (existing !== undefined) {
        // Already signed in: do not start a device flow that would shadow the
        // connected state; re-login goes through an explicit logout first.
        return { kind: 'success', text: '当前已有 ChatGPT 凭据。如需重新登录，请先运行 /codex-logout。' }
      }
      login.start()
      const state = await login.waitState(30000)
      if (state?.status === 'pending') {
        return {
          kind: 'success',
          text: `请在浏览器打开 ${state.verificationUri}，输入设备码 ${state.userCode}（${minutesText(state.expiresInSeconds)} 内有效），然后运行 /codex-status 查看结果。`,
        }
      }
      if (state?.status === 'complete') {
        return {
          kind: 'success',
          text: `已连接 ChatGPT 账号${state.accountId !== undefined ? `（${state.accountId}）` : ''}。请在 Models 设置页把模型切到 codex-oauth 提供方。`,
        }
      }
      if (state?.status === 'failed') {
        return { kind: 'error', text: `Codex 登录失败：${state.message}` }
      }
      return { kind: 'success', text: '登录仍在启动中（网络较慢）。请稍后运行 /codex-status 获取设备码与状态。' }
    },
  })

  ctx.commands.register({
    name: 'codex-status',
    description: '查看 Codex 订阅登录状态',
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
      return { kind: 'success', text: '未登录。运行 /codex-login 开始登录。' }
    },
  })

  ctx.commands.register({
    name: 'codex-logout',
    description: '登出 ChatGPT 账号并删除本地 OAuth 凭据',
    async handler() {
      await login.logout()
      return { kind: 'success', text: '已登出，本地 OAuth 凭据已删除。' }
    },
  })
}
