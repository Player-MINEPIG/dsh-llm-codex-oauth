/**
 * Codex adapter for the dsh LLM seam.
 *
 * Builds on pi-ai's built-in `openai-codex` provider (ChatGPT Plus/Pro OAuth,
 * wire protocol `openai-codex-responses` against chatgpt.com/backend-api).
 * Auth is resolved by pi-ai itself: our Models collection carries the
 * DshCredentialStore, so every request resolves the OAuth credential through
 * the dsh credential seam and refreshes it inside the store's serialized
 * modify when expired — no login code and no token handling here.
 *
 * The stream translation follows the dsh-llm-pi-ai contract: pi-ai events
 * become StreamChunks, failures arrive as terminal `error` events, and the
 * finish chunk carries adapter-private replay state so later turns can
 * reconstruct provider-native assistant messages (signatures) for the
 * ChatGPT backend.
 *
 * @module dsh-llm-codex-oauth/adapter
 */
import {
  CallId,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  LlmAdapter,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  ReasoningEffortId,
  attributionHeaders,
  contentHasImage,
  isContextWindowExceededError,
  isQuotaExceededError,
} from '@deepseek-ai/dsh-llm'
import { getSupportedThinkingLevels, isContextOverflow } from '@earendil-works/pi-ai'

export const PROVIDER_NAME = 'OpenAI Codex (ChatGPT 订阅)'
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000

// ── context translation ─────────────────────────────────────────────────────

/** Parse tool-call argument JSON; tolerate model malformations with {}. */
function parseArguments(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {}
  return {}
}

/** Join the text blocks of a harness message. */
function flattenText(message) {
  return message.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
}

/** Flatten text recursively inside one tool result. */
function toolResultText(blocks) {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : block.type === 'tool-result' ? toolResultText(block.content) : ''))
    .join('')
}

function toolsOf(options) {
  return options.tools?.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
}

/** Assemble the request-level pi-ai context envelope. */
function piContext(options, messages) {
  const tools = toolsOf(options)
  return {
    ...(options.system !== undefined ? { systemPrompt: options.system } : {}),
    messages,
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
  }
}

// ── replay metadata ─────────────────────────────────────────────────────────

/** Durable pi-ai replay metadata for one assistant message. */
function toPiReplayState(message, providerRoute) {
  return {
    kind: 'codex-oauth',
    version: 1,
    api: message.api,
    // The harness source records the dsh route (e.g. "codex-oauth"), while
    // pi-ai's message.provider is the catalog id ("openai-codex"). Store the
    // route here so readReplayState's source check matches; the reconstructed
    // message re-derives the catalog id from the adapter.
    provider: providerRoute,
    model: message.model,
    ...(message.responseModel === undefined ? {} : { responseModel: message.responseModel }),
    ...(message.responseId === undefined ? {} : { responseId: message.responseId }),
    stopReason: message.stopReason,
    blocks: message.content.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text', ...(block.textSignature === undefined ? {} : { textSignature: block.textSignature }) }
        case 'thinking':
          return {
            type: 'reasoning',
            ...(block.thinkingSignature === undefined ? {} : { thinkingSignature: block.thinkingSignature }),
            ...(block.redacted === undefined ? {} : { redacted: block.redacted }),
          }
        case 'toolCall':
          return { type: 'tool-call', ...(block.thoughtSignature === undefined ? {} : { thoughtSignature: block.thoughtSignature }) }
        default:
          return { type: 'unknown' }
      }
    }),
  }
}

function invalidReplay(message) {
  throw new LlmError(`invalid codex-oauth replay state: ${message}`, 'INVALID_REPLAY_STATE')
}

/** Validate the adapter-private state before it reaches pi-ai. */
function readReplayState(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidReplay('expected an object')
  const state = value
  if (state['kind'] !== 'codex-oauth') return invalidReplay('unknown state kind')
  if (state['version'] !== 1) return invalidReplay(`unsupported version ${String(state['version'])}`)
  for (const key of ['api', 'provider', 'model']) {
    if (typeof state[key] !== 'string' || state[key].length === 0) return invalidReplay(`${key} must be a non-empty string`)
  }
  if (!['stop', 'length', 'toolUse', 'error', 'aborted'].includes(String(state['stopReason']))) return invalidReplay('unknown stopReason')
  if (state['responseModel'] !== undefined && typeof state['responseModel'] !== 'string') return invalidReplay('responseModel must be a string')
  if (state['responseId'] !== undefined && typeof state['responseId'] !== 'string') return invalidReplay('responseId must be a string')
  if (!Array.isArray(state['blocks'])) return invalidReplay('blocks must be an array')
  for (const [index, value] of state['blocks'].entries()) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidReplay(`block ${index} must be an object`)
    const block = value
    if (!['text', 'reasoning', 'tool-call'].includes(String(block['type']))) return invalidReplay(`block ${index} has an unknown type`)
    for (const signature of ['textSignature', 'thinkingSignature', 'thoughtSignature']) {
      if (block[signature] !== undefined && typeof block[signature] !== 'string') return invalidReplay(`block ${index} ${signature} must be a string`)
    }
    if (block['redacted'] !== undefined && typeof block['redacted'] !== 'boolean') return invalidReplay(`block ${index} redacted must be boolean`)
  }
  return state
}

/** Convert provider-neutral blocks without trusting them as same-model replay. */
function foreignAssistant(message) {
  const source = message.source.kind === 'model' ? message.source : undefined
  const content = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        content.push({ type: 'text', text: block.text })
        break
      case 'reasoning':
        content.push({ type: 'thinking', thinking: block.text })
        break
      case 'tool-call':
        content.push({ type: 'toolCall', id: block.id, name: block.name, arguments: parseArguments(block.arguments) })
        break
      case 'image':
        throw new LlmError('codex-oauth chat history cannot represent structured assistant image output', 'UNSUPPORTED_CONTENT')
      default:
        break
    }
  }
  return {
    role: 'assistant',
    content,
    api: 'dsh-foreign',
    provider: source?.provider ?? 'dsh-foreign',
    model: source?.model ?? 'dsh-foreign',
    usage: { input: 0, output: 0 },
    stopReason: content.some((piece) => piece.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 0,
  }
}

/** Recombine durable harness content with validated replay metadata. */
function replayedAssistant(message, source, rawState, providerId) {
  const state = readReplayState(rawState)
  if (state.provider !== source.provider) return invalidReplay('provider does not match assistant source')
  if (state.model !== source.model) return invalidReplay('model does not match assistant source')
  if (state.blocks.length !== message.content.length) return invalidReplay('block count does not match assistant content')
  return {
    role: 'assistant',
    content: message.content.map((block, index) => {
      const replay = state.blocks[index]
      if (replay === undefined || replay.type !== block.type) return invalidReplay(`block ${index} does not match assistant content`)
      switch (block.type) {
        case 'text':
          return {
            type: 'text',
            text: block.text,
            ...(replay.type === 'text' && replay.textSignature !== undefined ? { textSignature: replay.textSignature } : {}),
          }
        case 'reasoning':
          return {
            type: 'thinking',
            thinking: block.text,
            ...(replay.type === 'reasoning' && replay.thinkingSignature !== undefined ? { thinkingSignature: replay.thinkingSignature } : {}),
            ...(replay.type === 'reasoning' && replay.redacted !== undefined ? { redacted: replay.redacted } : {}),
          }
        case 'tool-call':
          return {
            type: 'toolCall',
            id: block.id,
            name: block.name,
            arguments: parseArguments(block.arguments),
            ...(replay.type === 'tool-call' && replay.thoughtSignature !== undefined ? { thoughtSignature: replay.thoughtSignature } : {}),
          }
        default:
          return invalidReplay(`block ${index} has an unsupported harness type`)
      }
    }),
    api: state.api,
    provider: providerId,
    model: state.model,
    ...(state.responseModel === undefined ? {} : { responseModel: state.responseModel }),
    ...(state.responseId === undefined ? {} : { responseId: state.responseId }),
    usage: { input: 0, output: 0 },
    stopReason: state.stopReason,
    timestamp: 0,
  }
}

/** Convert one durable harness assistant message into pi-ai history. */
function toPiAssistant(message, providerId) {
  const source = message.source
  return source.kind !== 'model' || source.replayState === undefined
    ? foreignAssistant(message)
    : replayedAssistant(message, source, source.replayState, providerId)
}

/** Text-only harness history conversion (image input is refused for now). */
function textOnlyContext(options, providerId) {
  const toolNames = new Map()
  const messages = []
  for (const message of options.messages) {
    if (contentHasImage(message.content)) throw new LlmError('codex-oauth image input is not supported yet', 'UNSUPPORTED_CONTENT')
    if (message.role === 'system') {
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      const assistant = toPiAssistant(message, providerId)
      for (const block of assistant.content) if (block.type === 'toolCall') toolNames.set(CallId(block.id), block.name)
      messages.push(assistant)
      continue
    }
    const text = flattenText(message)
    const results = message.content.filter((block) => block.type === 'tool-result')
    if (text.length > 0 || results.length === 0) messages.push({ role: 'user', content: text, timestamp: 0 })
    for (const result of results) {
      messages.push({
        role: 'toolResult',
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? 'unknown',
        content: [{ type: 'text', text: toolResultText(result.content) || '(no output)' }],
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }
  return piContext(options, messages)
}

// ── stream translation ──────────────────────────────────────────────────────

/** Map pi-ai usage into harness counts. */
function mapUsage(usage) {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    ...(usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {}),
    ...(usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {}),
  }
}

/** Classify a pi-ai error message into the harness error taxonomy. */
function classifyError(message) {
  if (/\b(?:401|403)\b/.test(message)) return 'AUTH'
  if (isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE
  if (/\b429\b|rate.?limit/i.test(message)) return 'RATE_LIMIT'
  if (/\b400\b|invalid.?request/i.test(message)) return 'INVALID_REQUEST'
  if (/\b5\d\d\b/.test(message)) return 'SERVER'
  if (/\btime(?:d)?\s*out\b|timeout/i.test(message)) return 'TIMEOUT'
  if (/stream ended (?:before|without)\b/i.test(message)) return 'TRANSPORT'
  if (/\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i.test(message) || /\b(?:other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly)\b/i.test(message) || /\bterminated\b|premature close/i.test(message)) return 'TRANSPORT'
  return 'CODEX_ERROR'
}

/** Map a terminal pi-ai event to the harness finish reason. */
function mapStopReason(message, contextWindow) {
  const piAiOverflow = isContextOverflow(message, contextWindow)
  const harnessOverflow = message.stopReason === 'error' && message.errorMessage !== undefined && isContextWindowExceededError(message.errorMessage)
  if (piAiOverflow || harnessOverflow) {
    return {
      kind: 'error',
      failure: {
        message: message.errorMessage ?? `codex-oauth detected context overflow for model "${message.model}"`,
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    }
  }
  switch (message.stopReason) {
    case 'stop':
      if (message.content.length === 0) {
        return {
          kind: 'error',
          failure: { message: `model "${message.model}" returned a completed response with no content`, code: EMPTY_RESPONSE_CODE },
        }
      }
      return { kind: 'stop' }
    case 'length':
      return { kind: 'max-tokens' }
    case 'toolUse':
      return { kind: 'tool-calls' }
    case 'aborted':
      return { kind: 'aborted', failure: { message: message.errorMessage ?? 'codex-oauth stream aborted', code: 'ABORTED' } }
    case 'error': {
      const text = message.errorMessage ?? 'codex-oauth stream error'
      return { kind: 'error', failure: { message: text, code: classifyError(text) } }
    }
    default:
      return { kind: 'stop' }
  }
}

/**
 * Translate the pi-ai event stream into StreamChunks. pi-ai never throws
 * mid-stream — failures arrive as `error` events, which become error/aborted
 * `finish` chunks. Throws STREAM_CLOSED if the source ends without a terminal
 * event.
 */
async function* toStreamChunks(events, contextWindow, providerRoute) {
  const toolIds = new Map()
  for await (const event of events) {
    switch (event.type) {
      case 'start':
        break
      case 'text_start':
        yield { type: 'block-start', index: event.contentIndex, blockType: 'text' }
        break
      case 'text_delta':
        yield { type: 'text-delta', index: event.contentIndex, text: event.delta }
        break
      case 'text_end':
        yield { type: 'block-end', index: event.contentIndex, block: { type: 'text', text: event.content } }
        break
      case 'thinking_start':
        yield { type: 'block-start', index: event.contentIndex, blockType: 'reasoning' }
        break
      case 'thinking_delta':
        yield { type: 'reasoning-delta', index: event.contentIndex, text: event.delta }
        break
      case 'thinking_end':
        yield { type: 'block-end', index: event.contentIndex, block: { type: 'reasoning', text: event.content } }
        break
      case 'toolcall_start': {
        const partial = event.partial.content[event.contentIndex]
        const id = partial?.type === 'toolCall' ? partial.id : ''
        const name = partial?.type === 'toolCall' ? partial.name : ''
        toolIds.set(event.contentIndex, { id, name })
        yield { type: 'block-start', index: event.contentIndex, blockType: 'tool-call' }
        break
      }
      case 'toolcall_delta': {
        const known = toolIds.get(event.contentIndex)
        yield {
          type: 'tool-call-delta',
          index: event.contentIndex,
          id: CallId(known?.id ?? ''),
          ...(known?.name !== undefined && known.name.length > 0 ? { name: known.name } : {}),
          argumentsDelta: event.delta,
        }
        break
      }
      case 'toolcall_end':
        yield {
          type: 'block-end',
          index: event.contentIndex,
          block: { type: 'tool-call', id: CallId(event.toolCall.id), name: event.toolCall.name, arguments: JSON.stringify(event.toolCall.arguments) },
        }
        break
      case 'done':
        yield { type: 'usage', usage: mapUsage(event.message.usage) }
        yield { type: 'finish', reason: mapStopReason(event.message, contextWindow), replayState: toPiReplayState(event.message, providerRoute) }
        return
      case 'error':
        yield { type: 'usage', usage: mapUsage(event.error.usage) }
        yield { type: 'finish', reason: mapStopReason(event.error, contextWindow) }
        return
      default:
        break
    }
  }
  throw new LlmError('codex-oauth event stream ended without done/error', 'STREAM_CLOSED')
}

// ── idle watchdog ───────────────────────────────────────────────────────────

/** Abort the stream when no chunk arrives for `timeoutMs`. */
function idleWatchdog(signal, timeoutMs) {
  let timer = null
  let timedOut = false
  const controller = new AbortController()
  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  const arm = () => {
    clear()
    timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('LLM_STREAM_IDLE_TIMEOUT'))
    }, timeoutMs)
  }
  signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    next: async (iterator) => {
      arm()
      try {
        return await iterator.next()
      } finally {
        clear()
      }
    },
  }
}

// ── reasoning ───────────────────────────────────────────────────────────────

/** Validate an explicit harness/profile effort without invoking pi-ai's clamp. */
function resolveReasoningLevel(model, effort) {
  if (effort === undefined) return undefined
  if (getSupportedThinkingLevels(model).some((level) => level === effort)) return effort
  throw new LlmError(`codex-oauth provider "${model.provider}" model "${model.id}" does not support reasoning effort "${effort}"`, 'UNSUPPORTED_REASONING_EFFORT')
}

/** Adapter-owned selectable reasoning levels when exposed. */
function reasoningInfo(model) {
  if (!model.reasoning) return {}
  return {
    reasoning: {
      efforts: getSupportedThinkingLevels(model).map((level) => ({
        id: ReasoningEffortId(level),
        name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
      })),
    },
  }
}

// ── adapter ─────────────────────────────────────────────────────────────────

/**
 * dsh adapter over pi-ai's built-in openai-codex provider. One instance owns
 * one dsh provider route; auth is pi-ai's own OAuth resolution against the
 * credential store.
 */
export class CodexAdapter extends LlmAdapter {
  #models
  #providerId
  #provider
  #streamIdleTimeoutMs

  /**
   * @param models - pi-ai Models collection carrying the codex provider and the DshCredentialStore.
   * @param providerId - pi-ai catalog provider id (openai-codex).
   * @param provider - dsh provider route (codex-oauth), recorded in replay state.
   * @param options.streamIdleTimeoutMs - per-chunk idle timeout.
   */
  constructor(models, providerId, provider, { streamIdleTimeoutMs = DEFAULT_STREAM_IDLE_TIMEOUT_MS } = {}) {
    super()
    this.#models = models
    this.#providerId = providerId
    this.#provider = provider
    this.#streamIdleTimeoutMs = streamIdleTimeoutMs
  }

  providerInfo(provider) {
    return { id: provider, name: PROVIDER_NAME }
  }

  listModels(provider) {
    return Promise.resolve().then(() =>
      this.#models.getModels(this.#providerId).map((model) => ({
        provider,
        id: model.id,
        name: model.name,
        inputModalities: [...model.input],
      })),
    )
  }

  resolveModel(provider, model) {
    return Promise.resolve().then(() => {
      const resolved = this.#models.getModel(this.#providerId, model)
      if (resolved === undefined) throw new LlmError(`codex-oauth provider "${this.#providerId}" has no configured model "${model}"`, 'UNKNOWN_MODEL')
      return {
        provider,
        id: model,
        name: resolved.name,
        inputModalities: [...resolved.input],
        context: { contextWindow: resolved.contextWindow },
        ...reasoningInfo(resolved),
      }
    })
  }

  async *stream(options) {
    if (options.stop !== undefined) throw new LlmError('codex-oauth does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    const model = this.#models.getModel(this.#providerId, options.model)
    if (model === undefined) throw new LlmError(`codex-oauth provider "${this.#providerId}" has no configured model "${options.model}"`, 'UNKNOWN_MODEL')
    const reasoning = resolveReasoningLevel(model, options.reasoningEffort)
    const consumer = new AbortController()
    const upstream = options.signal === undefined ? consumer.signal : AbortSignal.any([options.signal, consumer.signal])
    const watchdog = idleWatchdog(upstream, this.#streamIdleTimeoutMs)
    try {
      const context = textOnlyContext(options, this.#providerId)
      const iterator = toStreamChunks(
        this.#models.streamSimple(model, context, {
          ...(reasoning === undefined ? {} : { reasoning }),
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
          ...(options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) }),
          signal: watchdog.signal,
          headers: attributionHeaders(),
        }),
        model.contextWindow,
        this.#provider,
      )[Symbol.asyncIterator]()
      let exhausted = false
      try {
        while (true) {
          const result = await watchdog.next(iterator)
          if (watchdog.timedOut()) throw new LlmError(`codex-oauth stream idle timeout after ${this.#streamIdleTimeoutMs}ms`, 'TIMEOUT')
          if (result.done) {
            exhausted = true
            return
          }
          yield result.value
        }
      } finally {
        if (!exhausted) {
          consumer.abort('codex-oauth stream consumer stopped')
          try {
            await iterator.return(undefined)
          } catch {}
        }
      }
    } catch (error) {
      if (watchdog.timedOut()) throw new LlmError(`codex-oauth stream idle timeout after ${this.#streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      if (options.signal?.aborted) throw new LlmError('codex-oauth request aborted by caller', 'ABORTED', { cause: error })
      throw error
    } finally {
      consumer.abort('codex-oauth stream consumer stopped')
    }
  }
}
