/**
 * dsh-llm-codex-oauth — use your ChatGPT/Codex subscription inside dsh.
 *
 * One host-plane plugin row: registers the `codex-oauth` provider route on the
 * dsh LLM seam (backed by pi-ai's built-in openai-codex provider + OAuth
 * credential store bridged to dsh credentials) and three user commands
 * (/codex-login, /codex-status, /codex-logout).
 *
 * Namespace plugin shape: named exports `name` / `inject` / `apply`, no
 * default export (the loader resolves the row `name:` to this package).
 *
 * @module dsh-llm-codex-oauth
 */
import { createModels } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { DshCredentialStore } from './store.js'
import { CodexAdapter } from './adapter.js'
import { LoginManager } from './login.js'
import { installCommands } from './commands.js'

export const name = 'dsh-llm-codex-oauth'

/** Hard dependencies: all three are mounted by the dsh base composition. */
export const inject = ['llm', 'credentials', 'commands']

const DEFAULTS = {
  provider: 'codex-oauth',
  providerId: 'openai-codex',
  credentialRef: 'OPENAI_CODEX_OAUTH',
  streamIdleTimeoutMs: 300000,
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

  const catalogProvider = builtinProviders().find((entry) => entry.id === providerId)
  if (catalogProvider === undefined) {
    throw new Error(`dsh-llm-codex-oauth: the installed pi-ai ships no provider "${providerId}"`)
  }

  // Credential store bridged to dsh credentials; the codex provider resolves
  // OAuth through it and refreshes inside its serialized modify.
  const store = new DshCredentialStore(ctx, credentialRef, providerId)
  const models = createModels({ credentials: store })
  models.setProvider(catalogProvider)

  ctx.llm.registerAdapter([provider], new CodexAdapter(models, providerId, { streamIdleTimeoutMs }))

  const login = new LoginManager(ctx, models, providerId)
  installCommands(ctx, login, store, providerId)

  ctx.logger.info(`dsh-llm-codex-oauth: provider "${provider}" ready (pi-ai ${providerId}; credential ${credentialRef})`)
}
