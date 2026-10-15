import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ideaSchema, detailSchema, validateOutput, parseOutput, sourceForMode, sourceLabel } from '../src/demo/ai-contract.js'
import { freshLibrary, saveRecord, writeLibrary, readLibrary, validateLibrary } from '../src/demo/storage.js'
import { generateOnDevice, MODEL_ID, modelGenerate, checkGPU } from '../src/demo/ai.js'

export const args = { categoryId: 'food', category: '음식 개발', words: ['딸기', '자전거', '구름'], condition: '작게 시험하기', type: 'generate' }
export const output = {
  title: '구름 한입 딸기 카트', one_liner: '자전거 카트에서 구름 모양 딸기 디저트를 파는 작은 서비스',
  description: '딸기와 요거트를 구름 모양 컵에 담아 제공합니다. 자전거 카트를 이용해 동네 공원을 이동하며 시식 메뉴 하나로 시작합니다.',
  steps: ['딸기 요거트 메뉴 한 가지를 만들어 시식하기', '자전거 카트에서 제공할 주문과 전달 동선 그리기', '구름 모양 포장 견본을 만들어 세 명에게 의견 묻기'],
  word_links: { material: '딸기를 디저트의 핵심 재료로 사용합니다.', method: '자전거 카트로 판매 장소를 옮깁니다.', mood: '구름 모양 컵과 가벼운 질감으로 분위기를 만듭니다.' },
}
export const detail = {
  target_user: '공원에서 가벼운 간식을 찾는 동네 주민', problem: '산책 중에 간편한 딸기 간식을 사기 어렵습니다.',
  value: '자전거 카트로 가까운 곳에 구름 디저트를 제공합니다.',
  core_features: ['딸기 요거트 메뉴 한 가지 제공하기', '공원 산책길에 자전거 카트 배치하기', '구름 모양 포장으로 가벼운 경험 만들기'],
  first_prototype: '종이 카트 견본과 시식 메뉴를 만들어 세 명에게 보여줍니다.', risks: ['식품 보관 온도와 판매 장소의 허가 조건을 확인해야 합니다.'],
}
const clone = value => structuredClone(value)
test('uniform schemas require exact fields and closed objects for both tasks', () => {
  for (const schema of [ideaSchema, detailSchema, ideaSchema.properties.word_links]) {
    assert.equal(schema.additionalProperties, false)
    assert.deepEqual(schema.required, Object.keys(schema.properties))
  }
  assert.deepEqual(ideaSchema.required, ['title', 'one_liner', 'description', 'steps', 'word_links'])
  assert.equal(validateOutput(output), output)
  assert.equal(validateOutput(detail, 'elaborate'), detail)
})
test('generic validation rejects missing, wrong-type, short, duplicate, refusal and truncated JSON', () => {
  for (const mutate of [
    v => { delete v.title }, v => { v.title = 7 }, v => { v.one_liner = null },
    v => { v.description = '짧음' }, v => { v.steps = 'bad' }, v => { v.steps.pop() },
    v => { v.steps[2] = ` ${v.steps[0]}!` }, v => { v.word_links = null },
    v => { v.word_links.method = v.word_links.material }, v => { v.apiKey = 'untrusted extra field' },
    v => { v.one_liner = '죄송하지만 이 요청에 응답할 수 없습니다.' },
  ]) { const value = clone(output); mutate(value); assert.throws(() => validateOutput(value)) }
  assert.throws(() => parseOutput('{"title":', 'generate'))
  assert.throws(() => validateOutput(output, 'develop', { description: output.description, steps: output.steps }))
})
test('detail validation rejects empty risks, duplicate features and empty or repeated descriptions', () => {
  for (const mutate of [v => { v.risks = [] }, v => { v.risks = ['짧음'] }, v => { v.core_features[2] = v.core_features[0] }, v => { v.problem = '' }, v => { v.value = v.problem }, v => { v.risks = Array(4).fill(detail.risks[0]) }]) {
    const value = clone(detail); mutate(value); assert.throws(() => validateOutput(value, 'elaborate'))
  }
})
test('WebLLM default is an installed official 1.5B preset', () => {
  const source = readFileSync(new URL('../node_modules/@mlc-ai/web-llm/lib/index.js', import.meta.url), 'utf8')
  assert.equal(MODEL_ID, 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC')
  assert.ok(source.includes(`model_id: "${MODEL_ID}"`))
})
test('ondevice transport requests schema and stamps only real model provenance', async () => {
  let request
  const engine = { chat: { completions: { create: async value => { request = value; return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] } } } } }
  const result = await generateOnDevice(args, engine)
  assert.equal(result.source, 'webllm'); assert.equal(result.model, MODEL_ID)
  assert.deepEqual(JSON.parse(request.response_format.schema), ideaSchema)
  const stored = saveRecord(freshLibrary(), result, { name: result.title, folderId: 'default' })
  const memory = new Map(), storage = { setItem: (k, v) => memory.set(k, v), getItem: k => memory.get(k) }
  writeLibrary(stored, storage); assert.equal(readLibrary(storage).library.ideas[0].source, 'webllm')
})
test('ondevice truncation and refusal reject instead of producing demo results', async () => {
  for (const choice of [{ finish_reason: 'length', message: { content: JSON.stringify(output) } }, { finish_reason: 'stop', message: { refusal: 'no', content: '{}' } }]) {
    await assert.rejects(generateOnDevice(args, { chat: { completions: { create: async () => ({ choices: [choice] }) } } }))
  }
  await assert.rejects(modelGenerate(args), /모델을 준비/)
  assert.equal(await checkGPU(), false)
})
test('ondevice abort and timeout interrupt captured engine and reject late success', async () => {
  for (const timeout of [false, true]) {
    const controller = new AbortController(); let interrupted = 0
    const engine = { interruptGenerate: () => { interrupted++ }, chat: { completions: { create: () => new Promise(() => {}) } } }
    const result = generateOnDevice(args, engine, { signal: controller.signal, timeoutMs: timeout ? 5 : 1000 })
    if (!timeout) controller.abort()
    await assert.rejects(result, { name: timeout ? 'TimeoutError' : 'AbortError' }); assert.equal(interrupted, 1)
  }
})
test('mode and result labels distinguish cloud, ondevice, rules and unknown older records', () => {
  assert.equal(sourceForMode('cloud'), 'cloud'); assert.equal(sourceForMode('ai'), 'webllm'); assert.equal(sourceForMode('local'), 'local')
  assert.match(sourceLabel('cloud'), /클라우드/); assert.match(sourceLabel('webllm'), /온디바이스/); assert.match(sourceLabel('local'), /규칙/); assert.match(sourceLabel(undefined), /미확인/)
  assert.equal(sourceLabel('rules'), sourceLabel('local'))
  assert.equal(sourceLabel('native-llama'), '실제 네이티브 온디바이스 AI · llama.cpp 생성')
})
test('native backup import and archive round-trip preserve genuine native and rules source marks', () => {
  const nativeBackup = { ...freshLibrary(), ideas: ['native-llama', 'rules'].map(source => ({
    ...output, id: `native-backup-${source}`, name: output.title, used_words: args.words,
    categoryId: args.categoryId, category: args.category, condition: args.condition,
    folderId: 'default', savedAt: '2026-10-14T00:00:00.000Z', revision: 1,
    source, elaboration: detail, elaborationSource: source,
  })) }
  const imported = validateLibrary(JSON.parse(JSON.stringify(nativeBackup)))
  const memory = new Map(), storage = { setItem: (k, v) => memory.set(k, v), getItem: k => memory.get(k) }
  writeLibrary(imported, storage)
  const restored = readLibrary(storage)
  assert.equal(restored.error, '')
  assert.deepEqual(restored.library.ideas.map(record => record.source), ['native-llama', 'rules'])
  for (const record of restored.library.ideas) {
    const expected = record.source === 'rules' ? sourceLabel('local') : '실제 네이티브 온디바이스 AI · llama.cpp 생성'
    assert.equal(sourceLabel(record.source), expected)
    assert.equal(sourceLabel(record.elaborationSource), expected)
  }
  const ui = readFileSync(new URL('../src/demo-main.jsx', import.meta.url), 'utf8')
  assert.match(ui, /className="source-tag">\{sourceLabel\(record\.source\)\}/)
})
