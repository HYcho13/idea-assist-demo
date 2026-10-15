import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cloudGenerate, CLOUD_MODEL, CLOUD_ENDPOINT } from '../src/demo/cloud-ai.js'
import { ideaSchema, detailSchema } from '../src/demo/ai-contract.js'
import { freshLibrary, saveRecord, writeLibrary, readLibrary } from '../src/demo/storage.js'

const apiKey = 'mock-key-for-transport-tests-only'
const args = { categoryId: 'program', category: '프로그램 개발', words: ['독서', '지도', '여행'], condition: '작게 시험하기', type: 'generate' }
const output = {
  title: '독서 여행 지도', one_liner: '읽은 책의 장소와 감상을 지도 위에 저장하는 기록 앱',
  description: '사용자는 독서 중 떠올린 장소를 지도에 표시하고 짧은 감상을 저장합니다. 여행 경로처럼 기록을 다시 둘러보며 읽은 책을 떠올립니다.',
  steps: ['독서 기록에 필요한 장소와 감상 입력 항목 정하기', '지도 위에 기록 카드 세 개를 배치한 화면 그리기', '여행처럼 기록을 둘러보며 원하는 책을 찾는지 확인하기'],
  word_links: { material: '독서 후 남긴 감상을 기록 소재로 사용합니다.', method: '지도 위에 책의 장소와 감상을 표시합니다.', mood: '여행하듯 기록을 둘러보는 화면을 제공합니다.' },
}
const detail = { target_user: '읽은 책을 다시 떠올리고 싶은 독서 모임 회원', problem: '책에서 떠올린 장소와 감상을 함께 기억하기 어렵습니다.', value: '지도에서 독서 여행을 다시 살펴보며 기록을 찾습니다.', core_features: ['장소별 독서 감상을 지도에 기록하기', '책별로 여행 기록 카드 묶어 보기', '지도 경로에서 이전 기록 찾아가기'], first_prototype: '종이 지도 위에 기록 카드 세 개를 붙여 모임에서 사용해 봅니다.', risks: ['기록이 늘어나면 지도에서 원하는 책을 찾기 어려울 수 있습니다.'] }
const payload = (value = output) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] })
const reply = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value })
const call = (value, status = 200, request = args) => cloudGenerate(request, { apiKey, fetchImpl: async () => reply(value, status) })

test('Responses transport fixes HTTPS endpoint, model, no-store and strict shared JSON schema', async () => {
  let request
  const result = await cloudGenerate(args, { apiKey, fetchImpl: async (url, options) => { request = { url, ...options }; return reply(payload()) } })
  assert.equal(request.url, CLOUD_ENDPOINT); assert.equal(request.url, 'https://api.openai.com/v1/responses')
  assert.equal(request.method, 'POST'); assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store')
  assert.equal(request.headers.Authorization, `Bearer ${apiKey}`); assert.ok(request.signal instanceof AbortSignal)
  const body = JSON.parse(request.body)
  assert.equal(body.model, 'gpt-4.1-mini'); assert.equal(CLOUD_MODEL, body.model); assert.equal(body.store, false)
  assert.deepEqual(body.text.format, { type: 'json_schema', name: 'idea', strict: true, schema: ideaSchema })
  assert.ok(!request.body.includes(apiKey)); assert.ok(!JSON.stringify(result).includes(apiKey))
  assert.equal(result.source, 'cloud'); assert.equal(result.model, CLOUD_MODEL)
  assert.deepEqual(result.used_words, args.words)
  const library = saveRecord(freshLibrary(), result, { name: result.title, folderId: 'default' })
  const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) }
  writeLibrary(library, storage); const restored = readLibrary(storage).library
  assert.equal(restored.ideas[0].source, 'cloud'); assert.ok(!JSON.stringify(restored).includes(apiKey))
})
test('development keeps ID, revision and genuine cloud source across an ondevice original', async () => {
  const current = { ...output, id: 'existing-id', revision: 2, source: 'webllm', used_words: args.words }
  const changed = { ...output, description: '지도 위에서 독서 여행의 기록을 이웃과 교환하는 작은 모임입니다. 첫 모임에서는 책 한 권의 장소만 함께 표시하고 감상을 읽습니다.', steps: ['책 한 권의 장소와 감상만 종이 지도에 표시하기', '두 명이 같은 장소에 남긴 기록 카드를 교환하기', '첫 모임 뒤 기록을 찾기 쉬웠는지 의견 확인하기'] }
  const result = await call(payload(changed), 200, { ...args, type: 'develop', current, direction: '더 현실적으로', directionId: 'realistic' })
  assert.equal(result.id, current.id); assert.equal(result.revision, 3); assert.equal(result.source, 'cloud'); assert.equal(result.direction, 'realistic')
  assert.ok(!Object.hasOwn(result, 'elaboration'))
})
test('elaboration uses the uniform detail contract and sends current idea with the condition', async () => {
  let body
  const result = await cloudGenerate({ ...args, type: 'elaborate', current: output }, { apiKey, fetchImpl: async (_, options) => { body = JSON.parse(options.body); return reply(payload(detail)) } })
  assert.deepEqual(body.text.format.schema, detailSchema); assert.equal(body.text.format.name, 'idea_detail'); assert.deepEqual(result, detail)
  assert.ok(body.input.at(-1).content.includes(args.condition)); assert.ok(body.input.at(-1).content.includes(output.title))
})
test('missing key never calls provider', async () => {
  let calls = 0
  await assert.rejects(cloudGenerate(args, { apiKey: '', fetchImpl: async () => { calls++ } }), /개인 OpenAI API 키/)
  assert.equal(calls, 0)
})
test('authentication, quota, rate limit and access errors are visible and never echo provider secrets', async () => {
  for (const [status, code, expected] of [[401, 'invalid_api_key', /인증/], [403, 'access_denied', /권한/], [429, 'insufficient_quota', /크레딧/], [429, 'rate_limit_exceeded', /요청 한도/], [500, 'server_error', /서비스 오류/], [400, 'invalid_request', /HTTP 400/]]) {
    await assert.rejects(call({ error: { code, message: `sensitive provider text ${apiKey}` } }, status), error => expected.test(error.message) && !error.message.includes(apiKey))
  }
  await assert.rejects(cloudGenerate(args, { apiKey, fetchImpl: async () => ({ ok: false, status: 401, json: async () => { throw new Error(apiKey) } }) }), /인증/)
})
test('network or CORS failures are visible without logging or leaking raw errors', async () => {
  await assert.rejects(cloudGenerate(args, { apiKey, fetchImpl: async () => { throw new TypeError(`CORS ${apiKey}`) } }), error => /CORS/.test(error.message) && !error.message.includes(apiKey))
})
test('refusal, incomplete status, truncated JSON, empty messages and malformed fields reject', async () => {
  for (const value of [
    { ...payload(), status: 'incomplete' }, { ...payload(), status: 'failed', error: { message: apiKey } },
    { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'no' }] }] },
    { status: 'completed', output: [] }, { status: 'completed', output: [{ ...payload().output[0], status: 'incomplete' }] },
    { status: 'completed', output: {} }, { status: 'completed', output: [null] },
    { status: 'completed', output: [{ ...payload().output[0], content: {} }] },
    { status: 'completed', output: [{ ...payload().output[0], content: [{ type: 'output_text', text: '{"title":' }] }] },
    payload({ ...output, steps: [output.steps[0], output.steps[0], output.steps[0]] }),
    payload({ ...output, description: 123 }), payload({ ...output, word_links: null }), payload({ ...output, title: '죄송하지만 응답할 수 없습니다.' }),
  ]) await assert.rejects(call(value))
  await assert.rejects(call(payload({ ...detail, risks: [] }), 200, { ...args, type: 'elaborate', current: output }))
})
test('abort cancels actual fetch signal and rejects even if the transport ignores cancellation', async () => {
  const controller = new AbortController(); let requestSignal, resolveFetch
  const result = cloudGenerate(args, { apiKey, signal: controller.signal, fetchImpl: (_, options) => { requestSignal = options.signal; return new Promise(resolve => { resolveFetch = resolve }) } })
  await Promise.resolve(); controller.abort()
  await assert.rejects(result, { name: 'AbortError' }); assert.equal(requestSignal.aborted, true)
  resolveFetch(reply(payload())); await Promise.resolve()
})
test('pre-aborted request never reaches the provider', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0
  await assert.rejects(cloudGenerate(args, { apiKey, signal: controller.signal, fetchImpl: () => { calls++ } }), { name: 'AbortError' })
  assert.equal(calls, 0)
})
test('immediate cancellation before transport starts also never reaches provider', async () => {
  const controller = new AbortController(); let calls = 0
  const result = cloudGenerate(args, { apiKey, signal: controller.signal, fetchImpl: () => { calls++ } })
  controller.abort()
  await assert.rejects(result, { name: 'AbortError' }); assert.equal(calls, 0)
})
test('same-word regeneration rejects the previous result without returning a duplicate', async () => {
  await assert.rejects(call(payload(), 200, { ...args, previous: output }), /그대로 반복/)
})
test('timeout covers fetch and body parsing, aborts signal and cannot return late results', async () => {
  for (const bodyHang of [false, true]) {
    let signal
    const result = cloudGenerate(args, { apiKey, timeoutMs: 5, fetchImpl: async (_, options) => {
      signal = options.signal
      return bodyHang ? { ok: true, status: 200, json: () => new Promise(() => {}) } : new Promise(() => {})
    } })
    await assert.rejects(result, { name: 'TimeoutError' }); assert.equal(signal.aborted, true)
  }
})
test('settings keep key in React memory and clearly disclose transmission and cost', () => {
  const ui = readFileSync(new URL('../src/demo-main.jsx', import.meta.url), 'utf8')
  const settings = readFileSync(new URL('../src/EngineSettings.jsx', import.meta.url), 'utf8')
  const cloud = readFileSync(new URL('../src/demo/cloud-ai.js', import.meta.url), 'utf8')
  assert.match(settings, /type="password"/); assert.match(settings, /type="checkbox" checked=\{consent\}/)
  assert.match(settings, /메모리에만/); assert.match(settings, /설정 저장하기/); assert.match(ui, /조건은 기록용/)
  assert.match(settings, /saveConsent\(draftProvider, consent\)/)
  assert.match(ui, /readConsent\(provider\)/)
  assert.ok(!/localStorage|indexedDB|console\./.test(cloud))
  const cancel = ui.slice(ui.indexOf('function cancelGeneration()'), ui.indexOf('function addCustom()'))
  assert.ok(!/setMode\(/.test(cancel))
  assert.ok(!ui.includes('apiKey:'))
})
