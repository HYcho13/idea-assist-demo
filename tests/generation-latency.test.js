import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { geminiGenerate, geminiRequest } from '../src/demo/gemini-ai.js'
import { compactGuidance, schemaFor, buildMessages } from '../src/demo/ai-contract.js'
import { elapsedSeconds, waitingMessage } from '../src/demo/generation-feedback.js'

const args = { type: 'generate', categoryId: 'food', category: '음식 개발', words: ['김치', '도시락', '숲'], condition: '5천 원 이하' }
const current = { title: '숲의 김치 도시락', description: '기존 아이디어 설명입니다.', steps: ['단계 하나', '단계 둘', '단계 셋'] }
test('Gemini uses supported low thinking without shrinking the output ceiling or changing JSON contracts', () => {
  for (const type of ['generate', 'develop', 'elaborate']) {
    const request = geminiRequest({ ...args, type, current: type === 'generate' ? undefined : current })
    assert.deepEqual(request.generationConfig.thinkingConfig, { thinkingLevel: 'low' })
    assert.equal(request.generationConfig.maxOutputTokens, 4096)
    assert.deepEqual(request.generationConfig.responseFormat.text.schema, schemaFor(type))
    const content = request.contents[0].parts[0].text
    assert.ok(content.includes(compactGuidance(type)))
    const data = JSON.parse(content.split('\n')[1])
    assert.equal(data.condition, args.condition)
    assert.equal(data.material, '김치'); assert.equal(data.method, '도시락'); assert.equal(data.mood, '숲')
  }
})
test('actual Gemini transport body contains low thinking and concise instructions', async () => {
  let body
  await assert.rejects(geminiGenerate(args, { apiKey: 'mock-latency-check-not-a-key', fetchImpl: async (_, options) => {
    body = JSON.parse(options.body)
    return { ok: true, json: async () => ({ candidates: [] }) }
  } }))
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'low')
  assert.match(body.contents[0].parts[0].text, /description은 60~160자 두 문장/)
  assert.doesNotMatch(buildMessages(args).at(-1).content, /description은 60~160자/)
  assert.match(compactGuidance('elaborate'), /core_features.*세 개/)
})
test('elapsed time uses real monotonic time, catches up after a delay, and never becomes negative', () => {
  assert.equal(elapsedSeconds(1000, 1000), 0)
  assert.equal(elapsedSeconds(1000, 10999), 9)
  assert.equal(elapsedSeconds(1000, 11000), 10)
  assert.equal(elapsedSeconds(1000, 61350), 60)
  assert.equal(elapsedSeconds(1000, 900), 0)
  assert.equal(elapsedSeconds(NaN, 1000), 0)
})
test('wait messages distinguish 10s and 30s without inventing model progress or success', () => {
  assert.equal(waitingMessage(9, 'cloud'), 'AI 응답을 기다리고 있어요.')
  assert.match(waitingMessage(10, 'cloud'), /제공업체 상황/)
  assert.match(waitingMessage(10, 'ai'), /기기 성능/)
  assert.match(waitingMessage(30, 'cloud'), /도착하지 않았어요.*취소/)
  assert.doesNotMatch(waitingMessage(60, 'cloud'), /정상|완료|%|곧/)
})
test('web feedback cleans up timers and background listeners without changing cancellation or adding rule delays', () => {
  const component = readFileSync(new URL('../src/GenerationProgress.jsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/demo-main.jsx', import.meta.url), 'utf8')
  assert.match(component, /performance.now\(\)/)
  assert.match(component, /setInterval\(update, 1000\)/)
  assert.match(component, /clearInterval\(timer\)/)
  assert.match(component, /removeEventListener\('visibilitychange', update\)/)
  assert.match(component, /aria-live="off"/)
  assert.match(component, /aria-live="polite"/)
  assert.match(app, /<GenerationProgress mode=\{mode\}/)
  assert.match(app, /onClick=\{cancelGeneration\}/)
  assert.doesNotMatch(app, /setTimeout\(resolve/)
})
test('native low setting, compact prompts and lifecycle-safe monotonic wait feedback match the web', () => {
  const native = file => readFileSync(new URL(`../android/app/src/main/java/com/ideaassist/app/${file}.kt`, import.meta.url), 'utf8')
  assert.match(native('GeminiApi'), /put\("thinkingLevel","low"\)/)
  assert.match(native('GeminiApi'), /put\("maxOutputTokens",4096\)/)
  assert.match(native('AiEngine'), /val examplePrefix = if\(compactCloud\) ""/)
  assert.match(native('AiEngine'), /description은 60~160자 두 문장/)
  assert.match(native('AppSession'), /startedAt = android.os.SystemClock.elapsedRealtime\(\)/)
  assert.match(native('MainActivity'), /override fun onStop\(\) \{ waitingHandler.removeCallbacks\(waitingTick\)/)
  assert.match(native('MainActivity'), /override fun onDestroy\(\) \{\s*waitingHandler.removeCallbacks\(waitingTick\)/)
  assert.match(native('MainActivity'), /waitingText\?\.text\?\.toString\(\)!=message/)
  assert.match(native('GenerationFeedback'), /seconds >= 30/)
})
