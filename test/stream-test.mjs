/**
 * Stream-translation tests for the installed dsh-llm-codex-oauth adapter:
 * pi-ai event stream → dsh StreamChunks, replay metadata round-trip, error
 * classification, option assembly, and guard rails. No network, no dsh boot.
 */
import { LlmError } from '@deepseek-ai/dsh-llm'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { CodexAdapter } from 'dsh-llm-codex-oauth/src/adapter.js'

let failed = 0
function check(label, ok, detail = '') {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failed += 1
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const codex = builtinProviders().find((p) => p.id === 'openai-codex')
const model = codex.getModels().find((m) => m.id === 'gpt-5.3-codex-spark')

function makeAdapter(eventsFactory, adapterOptions = {}) {
  let captured
  const models = {
    getModel: (_pid, mid) => (mid === model.id ? model : undefined),
    getModels: () => [model],
    streamSimple: (m, context, opts) => {
      captured = { m, context, opts }
      return eventsFactory()
    },
  }
  const adapter = new CodexAdapter(models, 'openai-codex', 'codex-oauth', { streamIdleTimeoutMs: 5000, ...adapterOptions })
  return { adapter, getCaptured: () => captured }
}

async function collect(adapter, options) {
  const chunks = []
  for await (const chunk of adapter.stream(options)) chunks.push(chunk)
  return chunks
}

const baseOptions = () => ({
  provider: 'codex-oauth',
  model: model.id,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
})

// ── T1: happy path — text + thinking + tool call + done ─────────────────────
async function* happyEvents() {
  yield { type: 'start', partial: null }
  yield { type: 'thinking_start', contentIndex: 0 }
  yield { type: 'thinking_delta', contentIndex: 0, delta: '思考' }
  yield { type: 'thinking_end', contentIndex: 0, content: '思考内容' }
  yield { type: 'text_start', contentIndex: 1 }
  yield { type: 'text_delta', contentIndex: 1, delta: 'Hi ' }
  yield { type: 'text_delta', contentIndex: 1, delta: 'there' }
  yield { type: 'text_end', contentIndex: 1, content: 'Hi there' }
  yield { type: 'toolcall_start', contentIndex: 2, partial: { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '' }, { type: 'toolCall', id: 'call_1', name: 'read' }] } }
  yield { type: 'toolcall_delta', contentIndex: 2, delta: '{"path":' }
  yield { type: 'toolcall_end', contentIndex: 2, toolCall: { id: 'call_1', name: 'read', arguments: { path: '/x' } } }
  yield {
    type: 'done',
    message: {
      api: 'openai-codex-responses', provider: 'openai-codex', model: model.id,
      responseModel: 'gpt-5.3-codex', responseId: 'resp_1', stopReason: 'stop',
      content: [
        { type: 'thinking', thinking: '思考内容', thinkingSignature: 'sig-t' },
        { type: 'text', text: 'Hi there', textSignature: 'sig-x' },
        { type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: '/x' }, thoughtSignature: 'sig-c' },
      ],
      usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 0 },
    },
  }
}

{
  const { adapter } = makeAdapter(happyEvents)
  const chunks = await collect(adapter, baseOptions())
  const types = chunks.map((c) => c.type).join(',')
  check('T1 chunk sequence', types === 'block-start,reasoning-delta,block-end,block-start,text-delta,text-delta,block-end,block-start,tool-call-delta,block-end,usage,finish', types)
  const reasoningEnd = chunks[2]
  check('T1 reasoning block', reasoningEnd.type === 'block-end' && reasoningEnd.block.type === 'reasoning' && reasoningEnd.block.text === '思考内容')
  const toolEnd = chunks[9]
  check('T1 tool call block', toolEnd.type === 'block-end' && toolEnd.block.type === 'tool-call' && toolEnd.block.id === 'call_1' && toolEnd.block.name === 'read' && toolEnd.block.arguments === JSON.stringify({ path: '/x' }))
  const toolDelta = chunks[8]
  check('T1 tool delta carries id/name', toolDelta.type === 'tool-call-delta' && toolDelta.id === 'call_1' && toolDelta.name === 'read' && toolDelta.argumentsDelta === '{"path":')
  const usage = chunks[10]
  check('T1 usage', usage.type === 'usage' && usage.usage.inputTokens === 100 && usage.usage.outputTokens === 50 && usage.usage.cacheReadTokens === 10 && usage.usage.cacheWriteTokens === undefined)
  const finish = chunks[11]
  check('T1 finish stop', finish.type === 'finish' && finish.reason.kind === 'stop')
  const replay = finish.replayState
  check('T1 replay kind', replay?.kind === 'codex-oauth' && replay?.version === 1 && replay?.api === 'openai-codex-responses' && replay?.responseId === 'resp_1')
  check('T1 replay provider is the route', replay?.provider === 'codex-oauth', String(replay?.provider))
  check('T1 replay signatures', replay?.blocks?.[0]?.type === 'reasoning' && replay?.blocks?.[0]?.thinkingSignature === 'sig-t' && replay?.blocks?.[1]?.textSignature === 'sig-x' && replay?.blocks?.[2]?.thoughtSignature === 'sig-c')
}

// ── T2: error event → classified finish ─────────────────────────────────────
async function* error401Events() {
  yield { type: 'start', partial: null }
  yield {
    type: 'error',
    error: {
      api: 'openai-codex-responses', provider: 'openai-codex', model: model.id,
      stopReason: 'error', errorMessage: 'request failed: 401 Unauthorized',
      content: [], usage: { input: 1, output: 0 },
    },
  }
}
{
  const { adapter } = makeAdapter(error401Events)
  const chunks = await collect(adapter, baseOptions())
  const finish = chunks.find((c) => c.type === 'finish')
  check('T2 error finish classified AUTH', finish?.reason?.kind === 'error' && finish?.reason?.failure?.code === 'AUTH', JSON.stringify(finish?.reason?.failure))
}

// ── T3: stream ends without terminal event ──────────────────────────────────
async function* truncatedEvents() {
  yield { type: 'start', partial: null }
  yield { type: 'text_delta', contentIndex: 0, delta: 'partial' }
}
{
  const { adapter } = makeAdapter(truncatedEvents)
  let closedOk = false
  try {
    await collect(adapter, baseOptions())
  } catch (error) {
    closedOk = error instanceof LlmError && error.failure?.code === 'STREAM_CLOSED'
  }
  check('T3 truncated stream throws STREAM_CLOSED', closedOk)
}

// ── T4: option assembly (headers / reasoning / passthrough) ─────────────────
async function* tinyEvents() {
  yield { type: 'start', partial: null }
  yield { type: 'text_start', contentIndex: 0 }
  yield { type: 'text_delta', contentIndex: 0, delta: 'ok' }
  yield { type: 'text_end', contentIndex: 0, content: 'ok' }
  yield {
    type: 'done',
    message: {
      api: 'openai-codex-responses', provider: 'openai-codex', model: model.id,
      stopReason: 'stop', content: [{ type: 'text', text: 'ok', textSignature: 'sig-o' }],
      usage: { input: 5, output: 1 },
    },
  }
}
{
  const { adapter, getCaptured } = makeAdapter(tinyEvents)
  await collect(adapter, { ...baseOptions(), system: 'sys prompt', tools: [{ name: 'read', description: 'r', parameters: { type: 'object' } }], reasoningEffort: 'high', temperature: 0.5, maxTokens: 1000, sessionId: 'sess-1' })
  const { context, opts } = getCaptured()
  check('T4 headers include attribution', typeof opts.headers === 'object' && opts.headers !== null && Object.keys(opts.headers).length > 0, JSON.stringify(Object.keys(opts.headers ?? {})))
  check('T4 reasoning passed', opts.reasoning === 'high')
  check('T4 temperature/maxTokens/sessionId passthrough', opts.temperature === 0.5 && opts.maxTokens === 1000 && opts.sessionId === 'sess-1')
  check('T4 abort signal passed', opts.signal instanceof AbortSignal)
  check('T4 system prompt mapped', context.systemPrompt === 'sys prompt')
  check('T4 tools mapped', context.tools?.length === 1 && context.tools[0].name === 'read' && context.tools[0].parameters?.type === 'object')
  check('T4 user message mapped', context.messages?.length === 1 && context.messages[0].role === 'user' && context.messages[0].content === 'hi')
}

// ── T5: replay metadata round-trip through history conversion ───────────────
{
  const { adapter, getCaptured } = makeAdapter(tinyEvents)
  const assistantMessage = {
    role: 'assistant',
    source: {
      kind: 'model', provider: 'codex-oauth', model: model.id,
      replayState: {
        kind: 'codex-oauth', version: 1, api: 'openai-codex-responses',
        provider: 'codex-oauth', model: model.id, responseId: 'resp_2',
        stopReason: 'stop', blocks: [{ type: 'text', textSignature: 'sig-prev' }],
      },
    },
    content: [{ type: 'text', text: 'earlier answer' }],
  }
  await collect(adapter, {
    provider: 'codex-oauth', model: model.id,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'first' }] },
      assistantMessage,
      { role: 'user', content: [{ type: 'text', text: 'again' }] },
    ],
  })
  const { context } = getCaptured()
  const replayed = context.messages?.[1]
  check('T5 replayed assistant keeps native identity', replayed?.api === 'openai-codex-responses' && replayed?.provider === 'openai-codex' && replayed?.responseId === 'resp_2')
  check('T5 replayed text keeps signature', replayed?.content?.[0]?.type === 'text' && replayed?.content?.[0]?.text === 'earlier answer' && replayed?.content?.[0]?.textSignature === 'sig-prev')
}

// ── T6: image input refused ─────────────────────────────────────────────────
{
  const { adapter } = makeAdapter(tinyEvents)
  let refused = false
  try {
    await collect(adapter, {
      provider: 'codex-oauth', model: model.id,
      messages: [{ role: 'user', content: [{ type: 'image', attachment: { id: 'img-1' } }] }],
    })
  } catch (error) {
    refused = error instanceof LlmError && error.failure?.code === 'UNSUPPORTED_CONTENT'
  }
  check('T6 image input refused with UNSUPPORTED_CONTENT', refused)
}

// ── T7: unsupported reasoning effort ────────────────────────────────────────
{
  const { adapter } = makeAdapter(tinyEvents)
  let refused = false
  try {
    await collect(adapter, { ...baseOptions(), reasoningEffort: 'xhigh' })
  } catch (error) {
    // xhigh is supported by this catalog model; a nonsense id must refuse.
    refused = false
  }
  try {
    await collect(adapter, { ...baseOptions(), reasoningEffort: 'nonsense' })
  } catch (error) {
    refused = error instanceof LlmError && error.failure?.code === 'UNSUPPORTED_REASONING_EFFORT'
  }
  check('T7 unknown reasoning effort refused', refused)
}

// ── T8: truly-foreign provider in replay state is rejected (regression) ─────
{
  const { adapter } = makeAdapter(tinyEvents)
  let rejected = false
  try {
    await collect(adapter, {
      provider: 'codex-oauth', model: model.id,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'first' }] },
        {
          role: 'assistant',
          source: {
            kind: 'model', provider: 'codex-oauth', model: model.id,
            replayState: {
              kind: 'codex-oauth', version: 1, api: 'openai-codex-responses',
              provider: 'deepseek-official', model: model.id, stopReason: 'stop',
              blocks: [{ type: 'text', textSignature: 'sig' }],
            },
          },
          content: [{ type: 'text', text: 'earlier' }],
        },
        { role: 'user', content: [{ type: 'text', text: 'again' }] },
      ],
    })
  } catch (error) {
    rejected = error instanceof LlmError && error.failure?.code === 'INVALID_REPLAY_STATE'
  }
  check('T8 foreign provider rejects with INVALID_REPLAY_STATE', rejected)
}

// ── T9: legacy replay state (catalog id) still accepts (back-compat) ────────
{
  const { adapter, getCaptured } = makeAdapter(tinyEvents)
  await collect(adapter, {
    provider: 'codex-oauth', model: model.id,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'first' }] },
      {
        role: 'assistant',
        source: {
          kind: 'model', provider: 'codex-oauth', model: model.id,
          replayState: {
            kind: 'codex-oauth', version: 1, api: 'openai-codex-responses',
            provider: 'openai-codex', model: model.id, stopReason: 'stop',
            blocks: [{ type: 'text', textSignature: 'sig-legacy' }],
          },
        },
        content: [{ type: 'text', text: 'legacy answer' }],
      },
      { role: 'user', content: [{ type: 'text', text: 'again' }] },
    ],
  })
  const replayed = getCaptured().context.messages?.[1]
  check('T9 legacy catalog-id replay accepted', replayed?.provider === 'openai-codex' && replayed?.api === 'openai-codex-responses')
  check('T9 legacy text keeps signature', replayed?.content?.[0]?.textSignature === 'sig-legacy')
}

// ── T10: proxy mode forces the HTTP/SSE transport ──────────────────────────
{
  const { adapter, getCaptured } = makeAdapter(tinyEvents, { forceSse: true })
  await collect(adapter, baseOptions())
  check('T10 proxy mode forces SSE transport', getCaptured()?.opts?.transport === 'sse', String(getCaptured()?.opts?.transport))
}

// ── T11: runtime proxy switch controls SSE transport ───────────────────────
{
  let enabled = false
  const { adapter, getCaptured } = makeAdapter(tinyEvents, { forceSse: () => enabled })
  await collect(adapter, baseOptions())
  check('T11 disabled runtime proxy keeps default transport', getCaptured()?.opts?.transport === undefined)
  enabled = true
  await collect(adapter, baseOptions())
  check('T11 enabled runtime proxy forces SSE transport', getCaptured()?.opts?.transport === 'sse')
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall stream-translation checks passed')
