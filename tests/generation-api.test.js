import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import { createApiServer } from '../api/server.js'
import { createModel, modelMessages, outputSchema } from '../api/model.js'
import { openapi } from '../api/openapi.js'

const input = { categoryId: 'food', words: ['김치', '도시락', '숲'], condition: '1인 가구를 위한 서비스' }
const idea = n => ({ title: `숲의 김치 도시락 ${n}`, one_liner: '김치 도시락을 숲 분위기로 즐기는 작은 음식 경험입니다.',
  description: `김치 중심의 도시락 메뉴를 만들고 숲 분위기의 안내를 함께 제공합니다. ${n}번 방식으로 예약과 시식을 나누어 사용자 의견을 확인합니다.`,
  steps: [`김치 메뉴 견본 ${n}개를 만들어 맛을 비교하기`, '도시락 예약 흐름을 종이에 그리고 직접 사용해 보기', '숲 분위기의 안내 카드를 만들어 사용성 질문하기'],
  word_links: { material: '김치를 주재료로 선택해 메뉴를 만듭니다.', method: '도시락 형태로 나누어 주문하고 전달합니다.', mood: '숲 분위기의 색상과 안내를 적용합니다.' } })
const detail = n => ({ target_user: '간단한 한 끼를 준비하고 싶은 혼자 사는 사용자', problem: '식사를 매번 준비할 때 메뉴 선택과 조리에 부담을 느낍니다.',
  value: '김치 도시락을 숲 콘셉트로 가볍게 경험하게 합니다.', core_features: ['김치 메뉴를 선택하는 작은 주문 화면', '도시락 예약과 수령을 확인하는 간단한 흐름', '숲 분위기의 안내와 경험 평가 카드'],
  first_prototype: `실험 ${n}: 도시락 견본을 사용자에게 제공하고 주문 과정의 불편을 직접 관찰합니다.`, risks: ['실제 사용자 필요와 알레르기는 별도로 확인해야 합니다.'] })
const generator = fn => ({ source: 'gemini', model: 'mock-test-only', generate: fn })
function defaultGenerator() {
  let calls = 0
  return generator(async args => {
    calls++
    return args.type === 'elaborate' ? detail(calls) : { ...idea(calls), ...(args.type === 'develop' ? { what_changed: '김치 메뉴 하나와 기존 도구만 남겨 첫 실험의 비용과 범위를 줄였습니다.' } : {}) }
  })
}
async function fixture(t, model = defaultGenerator(), options = {}) {
  const api = createApiServer({ generator: model, ...options })
  api.server.listen(0, '127.0.0.1')
  await once(api.server, 'listening')
  t.after(async () => { const closed = once(api.server, 'close'); api.close(); await closed })
  const base = `http://127.0.0.1:${api.server.address().port}`
  const request = async (path, { token, key, body, method = body === undefined ? 'GET' : 'POST', headers = {}, signal } = {}) => {
    const response = await fetch(base + path, { method, signal, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, headers: response.headers, body: await response.json() }
  }
  const create = async (body = input) => {
    const result = await request('/v1/generation-sessions', { body })
    assert.equal(result.status, 201)
    const { id, sessionToken: token } = result.body.data
    const path = `/v1/generation-sessions/${id}`
    return { id, token, path, snapshot: result.body.data,
      get: () => request(path, { token }),
      run: (action, body = {}, key = crypto.randomUUID(), extra = {}) => request(`${path}/${action}`, { token, key, body, ...extra }) }
  }
  return { api, base, request, create }
}

test('API bootstrap creates a private session without inference and publishes its exact routes', async t => {
  let calls = 0
  const f = await fixture(t, generator(async () => { calls++; return idea(calls) }))
  const s = await f.create()
  assert.equal(calls, 0)
  assert.equal(s.token.length, 43)
  assert.deepEqual(s.snapshot.words, input.words)
  assert.equal(s.snapshot.condition, input.condition)
  const read = await s.get()
  assert.equal(read.headers.get('cache-control'), 'no-store')
  assert.equal(read.body.data.sessionToken, undefined)
  assert.ok(!JSON.stringify(read.body).includes(s.token))
  const schema = (await f.request('/v1/openapi.json')).body
  assert.equal(schema.openapi, '3.1.0')
  for (const action of ['regenerate', 'develop', 'elaborate']) assert.ok(schema.paths[`/v1/generation-sessions/{id}/${action}`].post)
  assert.ok(schema.components.schemas.DevelopedIdea.required.includes('what_changed'))
  assert.equal((await f.request('/v1/health')).body.data.persistence, 'memory')
})

test('HTTP generate, regenerate, four develop directions, and repeated elaboration retain immutable context', async t => {
  const observed = []
  const base = defaultGenerator()
  const f = await fixture(t, generator(async (...args) => { observed.push(structuredClone(args[0])); return base.generate(...args) }))
  const s = await f.create()
  const first = await s.run('generate')
  assert.equal(first.status, 200)
  const next = await s.run('regenerate', { ideaId: first.body.data.id })
  assert.equal(next.status, 200)
  assert.notEqual(next.body.data.id, first.body.data.id)
  assert.notEqual(next.body.data.title, first.body.data.title)
  assert.equal(next.body.data.parentIdeaId, first.body.data.id)
  let current = next.body.data
  for (const direction of ['unique', 'realistic', 'fun', 'premium']) {
    const result = await s.run('develop', { ideaId: current.id, direction })
    assert.equal(result.status, 200)
    assert.equal(result.body.data.direction, direction)
    assert.match(result.body.data.what_changed, /기존 도구/)
    assert.equal(result.body.data.parentIdeaId, current.id)
    current = result.body.data
  }
  const a = await s.run('elaborate', { ideaId: current.id })
  const b = await s.run('elaborate', { ideaId: current.id })
  assert.equal(a.status, 200); assert.equal(b.status, 200)
  assert.notEqual(a.body.data.first_prototype, b.body.data.first_prototype)
  assert.equal(b.body.data.ideaId, current.id)
  assert.equal(b.body.data.revision, a.body.data.revision + 1)
  for (const args of observed) {
    assert.deepEqual(args.words, input.words)
    assert.equal(args.condition, input.condition)
    assert.equal(args.categoryId, input.categoryId)
  }
  assert.ok(observed.at(-1).current.elaboration)
  assert.equal((await s.get()).body.data.ideas.length, 6)
})

test('server validates optional condition, length, forbidden characters, body fields, words, topic and direction before calls', async t => {
  const f = await fixture(t)
  for (const condition of ['', '가'.repeat(100)]) assert.equal((await f.create({ ...input, condition })).snapshot.condition, condition)
  for (const condition of ['가'.repeat(101), 'a\n\u0000b', '\u202e숨김', '\ud800', 10, null]) {
    assert.equal((await f.request('/v1/generation-sessions', { body: { ...input, condition } })).status, 400)
  }
  for (const body of [[], null, { ...input, categoryId: '__proto__' }, { ...input, words: ['x', 'ｘ', 'b'] }, { ...input, words: ['a'] },
    { ...input, words: ['a', 'b', 'x'.repeat(13)] }, { ...input, topic: 5 }, { ...input, categoryId: 'custom' }, { ...input, apiKey: 'never-accepted' }]) {
    assert.equal((await f.request('/v1/generation-sessions', { body })).status, 400)
  }
  const custom = await f.create({ categoryId: 'custom', topic: '반려동물 여행', condition: '' })
  assert.equal(custom.snapshot.words.length, 3)
  assert.equal(custom.snapshot.topic, '반려동물 여행')
  const s = await f.create()
  assert.equal((await s.run('develop', { ideaId: 'x', direction: 'unknown' })).body.error.code, 'INVALID_DIRECTION')
  assert.equal((await s.run('generate', { words: ['a', 'b', 'c'] })).status, 400)
  assert.equal((await s.run('generate', {}, null)).body.error.code, 'IDEMPOTENCY_KEY_REQUIRED')
})

test('session tokens, foreign idea IDs and stale idea IDs cannot modify another/current result', async t => {
  const f = await fixture(t)
  const a = await f.create(), b = await f.create()
  const original = (await a.run('generate')).body.data
  assert.equal((await f.request(a.path)).status, 401)
  assert.equal((await f.request(a.path, { token: b.token })).status, 404)
  assert.equal((await b.run('develop', { ideaId: original.id, direction: 'fun' })).body.error.code, 'IDEA_NOT_IN_SESSION')
  assert.equal((await a.run('generate')).body.error.code, 'IDEA_ALREADY_EXISTS')
  await a.run('regenerate', { ideaId: original.id })
  assert.equal((await a.run('elaborate', { ideaId: original.id })).body.error.code, 'STALE_IDEA')
  assert.equal((await a.get()).body.data.ideas.length, 2)
})

test('successful Idempotency-Key replay is byte-equivalent data, including after later changes; conflicting reuse fails', async t => {
  let calls = 0
  const f = await fixture(t, generator(async () => idea(++calls)))
  const s = await f.create()
  const a = await s.run('generate', {}, 'first')
  const b = await s.run('generate', {}, 'first')
  assert.equal(calls, 1)
  assert.deepEqual(a.body.data, b.body.data)
  assert.equal(b.body.meta.replayed, true)
  await s.run('regenerate', { ideaId: a.body.data.id }, 'second')
  const again = await s.run('generate', {}, 'first')
  assert.deepEqual(again.body.data, a.body.data)
  assert.equal(calls, 2)
  assert.equal((await s.run('regenerate', { ideaId: a.body.data.id }, 'first')).body.error.code, 'IDEMPOTENCY_CONFLICT')
})

test('in-flight duplicates and concurrent actions are blocked; explicit cancel preserves previous result and ignores late success', async t => {
  let release, started
  const began = new Promise(resolve => { started = resolve })
  const f = await fixture(t, generator(async args => {
    if (!args.previous) return idea(1)
    started()
    return new Promise(resolve => { release = resolve })
  }))
  const s = await f.create()
  const original = (await s.run('generate')).body.data
  const pending = s.run('regenerate', { ideaId: original.id }, 'pending')
  await began
  assert.equal((await s.run('regenerate', { ideaId: original.id }, 'pending')).body.error.code, 'REQUEST_IN_PROGRESS')
  assert.equal((await s.run('elaborate', { ideaId: original.id }, 'other')).body.error.code, 'SESSION_BUSY')
  assert.equal((await s.get()).body.data.pendingRequestKey, 'pending')
  assert.equal((await s.run('cancel', { requestKey: 'wrong' })).body.data.cancelled, false)
  assert.equal((await s.run('cancel', { requestKey: 'pending' })).body.data.cancelled, true)
  assert.equal((await pending).body.error.code, 'REQUEST_CANCELLED')
  release(idea(2))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual((await s.get()).body.data.ideas, [original])
  assert.equal((await s.run('regenerate', { ideaId: original.id }, 'pending')).body.error.code, 'REQUEST_CANCELLED')
  assert.equal((await s.run('cancel', { requestKey: 'pending' })).body.data.cancelled, false)
})

test('deadline aborts the provider and never commits late data; failed key replay cannot incur another call', async t => {
  let release, signal, calls = 0
  const f = await fixture(t, generator(async (args, options) => {
    calls++
    if (calls === 1) return idea(1)
    signal = options.signal
    return new Promise(resolve => { release = resolve })
  }), { timeoutMs: 30 })
  const s = await f.create()
  const first = (await s.run('generate')).body.data
  const result = await s.run('regenerate', { ideaId: first.id }, 'slow')
  assert.equal(result.status, 504)
  assert.equal(result.body.error.code, 'AI_TIMEOUT')
  assert.equal(signal.aborted, true)
  release(idea(2))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual((await s.get()).body.data.ideas, [first])
  assert.equal((await s.run('regenerate', { ideaId: first.id }, 'slow')).status, 504)
  assert.equal(calls, 2)
})

test('HTTP disconnect aborts inference and preserves results without needing the cancel endpoint', async t => {
  let started, stopped
  const began = new Promise(resolve => { started = resolve })
  const ended = new Promise(resolve => { stopped = resolve })
  const f = await fixture(t, generator(async (_, { signal }) => {
    signal.addEventListener('abort', stopped, { once: true })
    started()
    return new Promise(() => {})
  }))
  const s = await f.create()
  const controller = new AbortController()
  const pending = s.run('generate', {}, 'disconnect', { signal: controller.signal }).catch(error => error.name)
  await began
  controller.abort()
  assert.equal(await pending, 'AbortError')
  await ended
  assert.deepEqual((await s.get()).body.data.ideas, [])
  assert.equal((await s.get()).body.data.pendingRequestKey, null)
})

test('provider errors, missing/invalid responses, repeated ideas and repeated prototypes do not overwrite state or expose secrets', async t => {
  let mode = 'good'
  const f = await fixture(t, generator(async args => {
    if (mode === 'error') throw new Error('private-upstream-key-and-internal-stack')
    if (mode === 'invalid') return { title: 'incomplete' }
    if (mode === 'no-reason') return idea(2)
    if (args.type === 'elaborate') return detail(1)
    return idea(1)
  }))
  const s = await f.create()
  const first = (await s.run('generate')).body.data
  for (const state of ['error', 'invalid', 'same']) {
    mode = state
    const r = await s.run('regenerate', { ideaId: first.id })
    assert.equal(r.status, state === 'error' ? 500 : 502)
    assert.ok(!JSON.stringify(r.body).includes('private-upstream'))
    assert.deepEqual((await s.get()).body.data.ideas, [first])
  }
  mode = 'no-reason'
  assert.equal((await s.run('develop', { ideaId: first.id, direction: 'fun' })).status, 502)
  mode = 'good'
  const a = await s.run('elaborate', { ideaId: first.id })
  assert.equal(a.status, 200)
  const b = await s.run('elaborate', { ideaId: first.id })
  assert.equal(b.status, 502)
  assert.deepEqual((await s.get()).body.data.ideas[0].elaboration, a.body.data)
})

test('session TTL, storage/request caps, and process-wide concurrency limits are enforced', async t => {
  let clock = Date.now()
  const f = await fixture(t, defaultGenerator(), { maxSessions: 1, ttlMs: 50, maxRequests: 1, now: () => clock })
  const s = await f.create()
  assert.equal((await f.request('/v1/generation-sessions', { body: input })).status, 503)
  const first = (await s.run('generate')).body.data
  assert.equal((await s.run('regenerate', { ideaId: first.id })).body.error.code, 'SESSION_REQUEST_LIMIT')
  clock += 51
  assert.equal((await s.get()).status, 404)
  await f.create()
  const blocked = await fixture(t, defaultGenerator(), { maxConcurrency: 0 })
  const b = await blocked.create()
  assert.equal((await b.run('generate')).body.error.code, 'SERVER_BUSY')
})

test('HTTP rejects bad origins/hosts/methods, non-JSON, oversized and malformed JSON, but allows preflight', async t => {
  const f = await fixture(t)
  assert.equal((await f.request('/v1/health', { headers: { Origin: 'https://evil.example' } })).status, 403)
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(f.base + '/v1/health', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode) })
    request.on('error', reject); request.end()
  })
  assert.equal(foreignHostStatus, 403)
  assert.equal((await f.request('/v1/health?key=not-accepted')).status, 400)
  assert.equal((await f.request('/v1/generation-sessions')).status, 405)
  const accepted = await f.request('/v1/health', { headers: { Origin: 'http://127.0.0.1:5180' } })
  assert.equal(accepted.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5180')
  const options = await fetch(f.base + '/v1/generation-sessions', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5180' } })
  assert.equal(options.status, 204)
  for (const [content, contentType, expected] of [['{', 'application/json', 400], ['{}', 'text/plain', 415], [JSON.stringify({ text: 'x'.repeat(20000) }), 'application/json', 413]]) {
    const response = await fetch(f.base + '/v1/generation-sessions', { method: 'POST', headers: { 'Content-Type': contentType }, body: content })
    assert.equal(response.status, expected)
    assert.ok((await response.json()).error.code)
  }
  const streamedStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(f.base + '/v1/generation-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode) })
    request.on('error', reject)
    request.write('{"text":"')
    request.write('x'.repeat(20000))
    request.end('"}')
  })
  assert.equal(streamedStatus, 413)
})

test('Gemini and OpenAI transport use fixed endpoints, server-only credentials, strict change schema and previous elaboration', async () => {
  for (const provider of ['gemini', 'openai']) {
    let captured
    const secret = 'mock-unit-test-credential-not-a-real-key'
    const model = createModel({ provider, apiKey: secret, fetchImpl: async (endpoint, options) => {
      captured = { endpoint, ...options }
      const output = { ...idea(2), what_changed: '기존 김치 메뉴의 핵심을 유지하고 도시락 견본의 범위를 줄였습니다.' }
      return Response.json(provider === 'gemini' ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] }
        : { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] })
    } })
    const result = await model.generate({ ...input, category: '음식 개발', type: 'develop', current: idea(1), direction: '더 현실적으로', directionId: 'realistic' }, { signal: new AbortController().signal })
    assert.ok(result.what_changed)
    assert.ok(captured.endpoint.startsWith(provider === 'gemini' ? 'https://generativelanguage.googleapis.com/' : 'https://api.openai.com/'))
    assert.ok(!captured.body.includes(secret) && !captured.endpoint.includes(secret))
    assert.equal(captured.redirect, 'error')
    const request = JSON.parse(captured.body)
    const schema = provider === 'gemini' ? request.generationConfig.responseFormat.text.schema : request.text.format.schema
    assert.deepEqual(schema, outputSchema('develop'))
    assert.ok(schema.required.includes('what_changed'))
  }
  const prompt = modelMessages({ ...input, category: '음식 개발', type: 'elaborate', current: { ...idea(1), elaboration: detail(1) } }).at(-1).content
  assert.match(prompt, /previous_elaboration/)
  assert.match(prompt, /기존과 다른 검증 방법/)
})

test('missing keys and provider rejection/truncation stay explicit errors; demo is opt-in and runs the complete HTTP journey', async t => {
  let calls = 0
  const absent = createModel({ provider: 'gemini', fetchImpl: async () => { calls++ } })
  await assert.rejects(absent.generate({}, {}), error => error.code === 'AI_NOT_CONFIGURED')
  assert.equal(calls, 0)
  for (const provider of ['gemini', 'openai']) {
    const key = 'mock-provider-error-private-value'
    for (const status of [400, 401, 403, 429, 500]) {
      const model = createModel({ provider, apiKey: key, fetchImpl: async () => Response.json({ error: { message: key } }, { status }) })
      await assert.rejects(model.generate({ ...input, category: '음식 개발', type: 'generate' }, {}), error => error.status === 502 && !error.message.includes(key))
    }
    const malformed = createModel({ provider, apiKey: key, fetchImpl: async () => Response.json(provider === 'gemini' ? { candidates: [{ finishReason: 'MAX_TOKENS' }] } : { status: 'incomplete', output: [] }) })
    await assert.rejects(malformed.generate({ ...input, category: '음식 개발', type: 'generate' }, {}), error => error.code === 'AI_INVALID_RESPONSE')
  }
  const f = await fixture(t, createModel({ provider: 'demo' }))
  const s = await f.create()
  const first = await s.run('generate')
  assert.equal(first.status, 200); assert.equal(first.body.data.source, 'local')
  const next = await s.run('regenerate', { ideaId: first.body.data.id })
  assert.equal(next.status, 200)
  const developed = await s.run('develop', { ideaId: next.body.data.id, direction: 'realistic' })
  assert.equal(developed.status, 200)
  assert.ok(developed.body.data.what_changed)
  const a = await s.run('elaborate', { ideaId: developed.body.data.id })
  const b = await s.run('elaborate', { ideaId: developed.body.data.id })
  assert.equal(a.status, 200); assert.equal(b.status, 200)
  assert.notEqual(a.body.data.first_prototype, b.body.data.first_prototype)
})

test('all response data matches the documented fields, required values and local schema references', async t => {
  // Focused contract check for this document's schema vocabulary (not a general JSON Schema validator).
  const fits = (value, schema) => {
    if (schema.$ref) return fits(value, openapi.components.schemas[schema.$ref.split('/').at(-1)])
    if (schema.anyOf) {
      assert.ok(schema.anyOf.some(option => { try { fits(value, option); return true } catch { return false } }))
      return
    }
    if (schema.const !== undefined) assert.equal(value, schema.const)
    if (schema.enum) assert.ok(schema.enum.includes(value))
    if (schema.type === 'null') assert.equal(value, null)
    if (schema.type === 'object') {
      assert.ok(value && typeof value === 'object' && !Array.isArray(value))
      for (const field of schema.required || []) assert.ok(Object.hasOwn(value, field), `Missing field ${field}`)
      for (const [field, item] of Object.entries(value)) {
        assert.ok(schema.properties[field] || schema.additionalProperties !== false, `Unexpected field ${field}`)
        if (schema.properties[field]) fits(item, schema.properties[field])
      }
    }
    if (schema.type === 'array') {
      assert.ok(Array.isArray(value))
      assert.ok(value.length >= (schema.minItems || 0) && value.length <= (schema.maxItems || Infinity))
      value.forEach(item => fits(item, schema.items))
      if (schema.uniqueItems) assert.equal(new Set(value).size, value.length)
    }
    if (schema.type === 'string') {
      assert.equal(typeof value, 'string')
      assert.ok(value.length >= (schema.minLength || 0) && value.length <= (schema.maxLength || Infinity))
      if (schema.pattern) assert.match(value, new RegExp(schema.pattern))
      if (schema.format === 'uuid') assert.match(value, /^[a-f0-9-]{36}$/)
    }
    if (schema.type === 'boolean') assert.equal(typeof value, 'boolean')
    if (schema.type === 'integer') { assert.ok(Number.isInteger(value)); assert.ok(value >= (schema.minimum ?? -Infinity)) }
  }
  const f = await fixture(t)
  const s = await f.create()
  fits(s.snapshot, openapi.components.schemas.CreatedSession)
  let result = await s.run('generate')
  fits(result.body, openapi.paths['/v1/generation-sessions/{id}/generate'].post.responses[200].content['application/json'].schema)
  result = await s.run('regenerate', { ideaId: result.body.data.id })
  fits(result.body.data, openapi.components.schemas.Idea)
  result = await s.run('develop', { ideaId: result.body.data.id, direction: 'premium' })
  fits(result.body.data, openapi.components.schemas.DevelopedIdea)
  result = await s.run('elaborate', { ideaId: result.body.data.id })
  fits(result.body.data, openapi.components.schemas.Elaboration)
  fits((await s.get()).body.data, openapi.components.schemas.Session)
  fits((await f.request(s.path)).body, openapi.components.schemas.Error)
})
