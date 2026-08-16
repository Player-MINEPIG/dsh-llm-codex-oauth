/** Persistent, runtime-editable proxy preference for the settings page. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { installCodexProxy } from './proxy.js'

function defaultSettingsPath() {
  const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
  return join(dshHome, 'codex-oauth-proxy.json')
}

function readPreference(path, configuredProxyUrl) {
  if (!existsSync(path)) {
    const proxyUrl = typeof configuredProxyUrl === 'string' ? configuredProxyUrl : ''
    return { enabled: proxyUrl.length > 0, proxyUrl }
  }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return {
      enabled: value?.enabled === true,
      proxyUrl: typeof value?.proxyUrl === 'string' ? value.proxyUrl : '',
    }
  } catch (error) {
    throw new Error(`dsh-llm-codex-oauth: cannot read proxy settings: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export class ProxySettings {
  #path
  #proxy
  #proxyUrl

  constructor(ctx, configuredProxyUrl, { path = defaultSettingsPath() } = {}) {
    this.#path = path
    const preference = readPreference(path, configuredProxyUrl)
    this.#proxyUrl = preference.proxyUrl
    this.#proxy = installCodexProxy(ctx, preference.enabled ? preference.proxyUrl : undefined)
  }

  get enabled() {
    return this.#proxy.enabled
  }

  get proxyUrl() {
    return this.#proxyUrl
  }

  get displayUrl() {
    return this.#proxy.displayUrl
  }

  update({ enabled, proxyUrl }) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
    if (typeof proxyUrl !== 'string') throw new Error('proxyUrl must be a string')
    const normalized = proxyUrl.trim()
    if (enabled && normalized.length === 0) throw new Error('启用代理前请填写代理地址')

    this.#proxy.setProxyUrl(enabled ? normalized : undefined)
    this.#proxyUrl = normalized

    mkdirSync(dirname(this.#path), { recursive: true })
    const temporary = `${this.#path}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify({ enabled, proxyUrl: normalized }, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.#path)
  }
}
