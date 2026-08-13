/**
 * Login orchestration for the OpenAI Codex OAuth flow.
 *
 * The heavy lifting lives in pi-ai: `Models.login(providerId, 'oauth',
 * interaction)` runs the provider's own OAuth flow and persists the resulting
 * credential through our DshCredentialStore. We auto-answer its method
 * selection with the device-code flow (headless friendly: no local callback
 * server, the user just visits a URL and types a code), and surface the
 * device code + verification URL as process-local state for the /codex-*
 * commands. State is memory-only by design: after a restart the durable truth
 * is the stored credential itself.
 *
 * @module dsh-llm-codex-oauth/login
 */

const DEVICE_CODE_METHOD = 'device_code'

export class LoginManager {
  #ctx
  #models
  #providerId
  #controller = undefined
  #state = undefined
  #waiters = []
  #listeners = []

  constructor(ctx, models, providerId) {
    this.#ctx = ctx
    this.#models = models
    this.#providerId = providerId
    // Stop any in-flight login when this plugin fiber is disposed.
    ctx.effect(() => () => this.#controller?.abort(new Error('plugin disposed')))
  }

  /** Current memory-only state: starting | pending | complete | failed | cancelled | signed-out. */
  get state() {
    return this.#state
  }

  #setState(state) {
    this.#state = state
    for (const resolve of this.#waiters.splice(0)) resolve(state)
    for (const listener of [...this.#listeners]) {
      try {
        listener(state)
      } catch {}
    }
  }

  /**
   * Subscribe to state transitions. The callback fires immediately with the
   * current state and then on every change; returns the unsubscribe function.
   */
  onState(callback) {
    this.#listeners.push(callback)
    callback(this.#state)
    return () => {
      const index = this.#listeners.indexOf(callback)
      if (index >= 0) this.#listeners.splice(index, 1)
    }
  }

  /**
   * Resolve with the current state as soon as it changes, or with whatever
   * the state is after `timeoutMs`.
   */
  waitState(timeoutMs = 30000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.#state), timeoutMs)
      this.#waiters.push((state) => {
        clearTimeout(timer)
        resolve(state)
      })
    })
  }

  /**
   * Start (or restart) the device-code login. Returns immediately; progress
   * is reported through `state` / `waitState`. The flow runs in the
   * background and persists the credential itself on success.
   */
  start() {
    // A new login supersedes any in-flight one.
    if (this.#controller !== undefined) this.#controller.abort(new Error('superseded by a new login'))
    const controller = new AbortController()
    this.#controller = controller
    this.#setState({ status: 'starting' })

    const interaction = {
      signal: controller.signal,
      // pi-ai asks which login method; device code is the headless-friendly one.
      prompt: async (prompt) => {
        if (prompt.type === 'select') return DEVICE_CODE_METHOD
        throw new Error(`codex login requires no ${prompt.type} prompt`)
      },
      notify: (event) => {
        if (event.type === 'device_code') {
          this.#setState({
            status: 'pending',
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds,
            expiresInSeconds: event.expiresInSeconds,
            startedAt: Date.now(),
          })
        }
      },
    }

    this.#models.login(this.#providerId, 'oauth', interaction).then(
      (credential) => {
        if (this.#controller !== controller) return
        this.#setState({
          status: 'complete',
          accountId: credential.accountId ?? undefined,
          expiresAt: credential.expires,
        })
      },
      (error) => {
        if (this.#controller !== controller) return
        if (controller.signal.aborted) this.#setState({ status: 'cancelled' })
        else this.#setState({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return this
  }

  /** Abort an in-flight login without touching a stored credential. */
  cancel() {
    this.#controller?.abort(new Error('cancelled by user'))
    this.#setState({ status: 'cancelled' })
  }

  /** Logout: abort any in-flight login and delete the stored credential. */
  async logout() {
    this.cancel()
    await this.#models.logout(this.#providerId)
    this.#setState({ status: 'signed-out' })
  }
}
