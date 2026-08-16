/**
 * Proxy support for the OpenAI Codex OAuth and ChatGPT backend requests.
 *
 * pi-ai uses the process-wide WHATWG fetch implementation. Node does not read
 * macOS' system proxy settings, so a browser may work while the host-side OAuth
 * request still goes direct. This module replaces fetch only for the two Codex
 * origins and restores the previous implementation when the plugin is disposed.
 */
import { Readable } from 'node:stream'
import nodeFetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'

const PROXIED_HOSTS = new Set(['auth.openai.com', 'chatgpt.com'])

function parseProxyUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('dsh-llm-codex-oauth: proxyUrl must be a non-empty HTTP(S) URL')
  }
  let url
  try {
    url = new URL(value)
  } catch (error) {
    throw new Error(`dsh-llm-codex-oauth: invalid proxyUrl: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`dsh-llm-codex-oauth: proxyUrl must use http: or https:, got ${url.protocol}`)
  }
  return url
}

function requestUrl(input) {
  if (typeof input === 'string' || input instanceof URL) return new URL(input)
  if (input !== null && typeof input === 'object' && typeof input.url === 'string') return new URL(input.url)
  return undefined
}

export function shouldProxyCodexRequest(input) {
  try {
    const url = requestUrl(input)
    return url?.protocol === 'https:' && PROXIED_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

function asWhatwgResponse(response) {
  if (response.body === null || typeof response.body?.getReader === 'function') return response
  const body = Readable.toWeb(response.body)
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/** Build a fetch wrapper that proxies only Codex OAuth/backend origins. */
export function createCodexProxyFetch(proxyUrl, {
  directFetch = globalThis.fetch,
  proxiedFetch = nodeFetch,
  createAgent = (url) => new HttpsProxyAgent(url),
} = {}) {
  if (typeof directFetch !== 'function') throw new Error('dsh-llm-codex-oauth: global fetch is unavailable')
  const parsed = parseProxyUrl(proxyUrl)
  const agent = createAgent(parsed)

  const fetch = async (input, init) => {
    if (!shouldProxyCodexRequest(input)) return directFetch(input, init)
    const response = await proxiedFetch(input, { ...init, agent })
    return asWhatwgResponse(response)
  }

  return {
    fetch,
    close() {
      if (typeof agent.destroy === 'function') agent.destroy()
    },
    displayUrl: `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`,
  }
}

/** Install a reconfigurable scoped fetch wrapper for one Cordis fiber. */
export function installCodexProxy(ctx, proxyUrl) {
  const previous = globalThis.fetch
  let proxy

  const controller = {
    get enabled() {
      return proxy !== undefined
    },
    get displayUrl() {
      return proxy?.displayUrl
    },
    setProxyUrl(value) {
      const next = value === undefined || value === null || value === ''
        ? undefined
        : createCodexProxyFetch(value, { directFetch: previous })
      if (proxy !== undefined) {
        if (globalThis.fetch === proxy.fetch) globalThis.fetch = previous
        proxy.close()
      }
      proxy = next
      if (proxy !== undefined) globalThis.fetch = proxy.fetch
    },
  }

  controller.setProxyUrl(proxyUrl)
  ctx.effect(() => () => {
    if (proxy !== undefined) {
      if (globalThis.fetch === proxy.fetch) globalThis.fetch = previous
      proxy.close()
      proxy = undefined
    }
  })
  return controller
}
