/**
 * Browser half: a settings-page section with login/logout controls.
 *
 * Bundled (react inlined, @deepseek-ai/* external) into dist/client.js and
 * discovered through the package.json `dsh.client` manifest. It registers one
 * `settings.section` entry and talks to the host over the same-origin HTTP
 * endpoints registered by src/server.js — no typert remotes.
 *
 * @module dsh-llm-codex-oauth/client
 */
import { createElement as h, useCallback, useEffect, useState } from 'react'

const SECTION_ID = 'codex-oauth'

function CodexSection() {
  const [data, setData] = useState(null)
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyDirty, setProxyDirty] = useState(false)
  const [proxyMessage, setProxyMessage] = useState('')

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/codex-oauth/status')
      setData(await response.json())
    } catch (error) {
      setData({ ok: false, statusText: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (!proxyDirty && typeof data?.proxyUrl === 'string') setProxyUrl(data.proxyUrl)
  }, [data?.proxyUrl, proxyDirty])

  const act = useCallback(async (operation) => {
    try {
      await fetch(`/codex-oauth/${operation}`, { method: 'POST' })
    } catch {}
    await refresh()
  }, [refresh])

  const connected = data?.connected === true
  const statusText = data?.statusText ?? '加载中…'
  // A single status line: pending (waiting for authorization) shows only the
  // actionable URL + device code; otherwise the plain status text. Re-clicking
  // login replaces `data`, so the prompt overwrites instead of stacking.
  const pending = !connected && data?.verificationUrl

  const updateProxy = useCallback(async (enabled) => {
    setProxyMessage('保存中…')
    try {
      const response = await fetch('/codex-oauth/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled, proxyUrl }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
      setData(result)
      setProxyDirty(false)
      setProxyMessage(enabled ? `代理已启用：${result.proxyDisplayUrl}` : '代理已关闭，当前使用直连')
    } catch (error) {
      setProxyMessage(error instanceof Error ? error.message : String(error))
      await refresh()
    }
  }, [proxyUrl, refresh])

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    pending
      ? h('p', null,
        '请打开 ',
        h('a', { href: data.verificationUrl, target: '_blank', rel: 'noreferrer' }, data.verificationUrl),
        '，输入设备码 ',
        h('b', null, data.userCode),
      )
      : h('p', null, statusText),
    connected
      ? h('button', { type: 'button', onClick: () => act('logout') }, '登出')
      : h('button', { type: 'button', onClick: () => act('login') }, '登录 ChatGPT 账号'),
    connected && data?.expiresAt
      ? h('p', null, 'access token 到期：', new Date(data.expiresAt).toLocaleString())
      : null,
    h('hr', { style: { width: '100%', border: 0, borderTop: '1px solid #ddd' } }),
    h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      h('input', {
        type: 'checkbox',
        checked: data?.proxyEnabled === true,
        onChange: (event) => updateProxy(event.target.checked),
      }),
      '使用 HTTP(S) 代理（可选）',
    ),
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      h('input', {
        type: 'url',
        value: proxyUrl,
        placeholder: 'http://127.0.0.1:7897',
        onChange: (event) => {
          setProxyUrl(event.target.value)
          setProxyDirty(true)
        },
        style: { minWidth: '260px', flex: '1 1 260px' },
      }),
      h('button', { type: 'button', onClick: () => updateProxy(data?.proxyEnabled === true) }, '保存代理地址'),
    ),
    proxyMessage ? h('p', null, proxyMessage) : null,
  )
}

export const name = 'dsh-llm-codex-oauth'
export const inject = ['slots']

export function apply(ctx) {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: 100,
    label: 'Codex 订阅 (ChatGPT)',
  }, CodexSection))
}
