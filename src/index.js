/**
 * dsh-llm-codex-oauth — use your ChatGPT/Codex subscription inside dsh.
 *
 * Host plane: registers the `codex-oauth` provider route on the dsh LLM seam
 * (pi-ai's built-in openai-codex provider + OAuth credential store bridged to
 * dsh credentials), exposes /codex-oauth HTTP routes for the settings-panel
 * client half (when a web server is present), and registers two read-only
 * conversation commands (/codex-status, /codex-logout).
 *
 * Namespace plugin shape: named exports `name` / `inject` / `apply`, no
 * default export. The browser half ships separately via `dsh.client` →
 * ./client (dist/client.js).
 *
 * @module dsh-llm-codex-oauth
 */
import { createModels } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { DshCredentialStore } from './store.js'
import { CodexAdapter } from './adapter.js'
import { LoginManager } from './login.js'
import { installCommands } from './commands.js'
import { installServerRoutes } from './server.js'
import { installCodexProxy } from './proxy.js'

export const name = 'dsh-llm-codex-oauth'

/** Hard dependencies: all three are mounted by the dsh base composition. */
export const inject = ['llm', 'credentials', 'commands']

const DEFAULTS = {
  provider: 'codex-oauth',
  providerId: 'openai-codex',
  credentialRef: 'OPENAI_CODEX_OAUTH',
  streamIdleTimeoutMs: 300000,
  proxyUrl: undefined,
}

/**
 * @param ctx - Cordis Context of the host composition.
 * @param config - the row config from cordis.patch.yml (see DEFAULTS).
 */
export function apply(ctx, config) {
  const provider = config?.provider ?? DEFAULTS.provider
  const providerId = config?.providerId ?? DEFAULTS.providerId
  const credentialRef = config?.credentialRef ?? DEFAULTS.credentialRef
  const streamIdleTimeoutMs = config?.streamIdleTimeoutMs ?? DEFAULTS.streamIdleTimeoutMs
  const proxyUrl = config?.proxyUrl ?? DEFAULTS.proxyUrl

  const catalogProvider = builtinProviders().find((entry) => entry.id === providerId)
  if (catalogProvider === undefined) {
    throw new Error(`dsh-llm-codex-oauth: the installed pi-ai ships no provider "${providerId}"`)
  }

  // Credential store bridged to dsh credentials; the codex provider resolves
  // OAuth through it and refreshes inside its serialized modify.
  const store = new DshCredentialStore(ctx, credentialRef, providerId)
  const models = createModels({ credentials: store })
  models.setProvider(catalogProvider)

  // Node does not inherit macOS system proxy settings. Install a scoped fetch
  // wrapper before any OAuth or model request, and force SSE because Node's
  // built-in WebSocket transport cannot accept an http.Agent proxy.
  const proxy = installCodexProxy(ctx, proxyUrl)

  ctx.llm.registerAdapter([provider], new CodexAdapter(models, providerId, provider, {
    streamIdleTimeoutMs,
    forceSse: proxy.enabled,
  }))

  const login = new LoginManager(ctx, models, providerId)
  installServerRoutes(ctx, login, store, providerId)
  installCommands(ctx, login, store, providerId)

  ctx.logger.info(`dsh-llm-codex-oauth: provider "${provider}" ready (pi-ai ${providerId}; credential ${credentialRef}${proxy.enabled ? `; proxy ${proxy.displayUrl}; transport sse` : ''})`)
}
