/**
 * pi-ai CredentialStore backed by the dsh credential seam.
 *
 * The OAuth credential ({ type, access, refresh, expires, accountId }) is
 * stored as one JSON string under a single credential reference. It never
 * enters a config file, a session log, or this repository. `modify` is the
 * only write path and is serialized per provider so concurrent streams cannot
 * double-refresh a rotated token.
 *
 * @module dsh-llm-codex-oauth/store
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** Shape check for a persisted pi-ai OAuth credential. */
function validCredential(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return (
    value.type === 'oauth'
    && typeof value.access === 'string' && value.access.length > 0
    && typeof value.refresh === 'string' && value.refresh.length > 0
    && typeof value.expires === 'number' && Number.isFinite(value.expires)
  )
}

export class DshCredentialStore {
  #ctx
  #ref
  #providerId
  /** Per-provider serialization tails: read-modify-write never interleaves. */
  #tails = new Map()

  /**
   * @param ctx - the plugin Context; `ctx.credentials` must be mounted.
   * @param refName - credential reference name (POSIX shell identifier).
   * @param providerId - pi-ai provider id this store serves.
   */
  constructor(ctx, refName, providerId) {
    this.#ctx = ctx
    this.#ref = credentialRef(refName)
    this.#providerId = providerId
  }

  #enqueue(providerId, fn) {
    const previous = this.#tails.get(providerId) ?? Promise.resolve()
    const next = previous.then(fn, fn)
    this.#tails.set(providerId, next.then(() => {}, () => {}))
    return next
  }

  /** Read the stored credential, possibly expired. Resolves undefined when absent. */
  async read(providerId) {
    const hit = await this.#ctx.credentials.resolve(this.#ref)
    if (hit === undefined || hit.value === '') return undefined
    try {
      const parsed = JSON.parse(hit.value)
      return validCredential(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }

  /** List stored credential metadata without exposing secrets. */
  async list() {
    const credential = await this.read(this.#providerId)
    return credential === undefined ? [] : [{ providerId: this.#providerId, type: 'oauth' }]
  }

  /**
   * Serialized write — the only write path. `fn` sees the current credential
   * and returns the replacement (or undefined to leave it unchanged).
   */
  modify(providerId, fn) {
    return this.#enqueue(providerId, async () => {
      const current = await this.read(providerId)
      const next = await fn(current)
      if (next === undefined) return current
      await this.#ctx.credentials.set(this.#ref, JSON.stringify(next))
      return next
    })
  }

  /** Remove the stored credential (logout). */
  delete(providerId) {
    return this.#enqueue(providerId, async () => {
      await this.#ctx.credentials.unset(this.#ref)
    })
  }
}
