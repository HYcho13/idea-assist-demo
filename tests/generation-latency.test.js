import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { geminiGenerate, geminiRequest } from '../src/demo/gemini-ai.js'
import { compactGuidance, schemaFor, buildMessages } from '../src/demo/ai-contract.js'

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
test('generation feedback is a single accessible spinner with no elapsed clock', () => {
  const component = readFileSync(new URL('../src/GenerationProgress.jsx', import.meta.url), 'utf8')
  assert.equal((component.match(/className="generation-spinner"/g) || []).length, 1)
  assert.match(component, /role="status" aria-label="AI 응답을 기다리고 있어요\."/)
  assert.match(component, /aria-hidden="true"/)
  assert.doesNotMatch(component, /performance|setInterval|useEffect|useState|경과 시간|seconds|waitingMessage/)
  assert.match(component, /취소해도 이미 처리된 요청에는 비용이 발생할 수 있어요/)
})
test('spinner reuses linear CSS rotation and respects reduced motion', () => {
  const css = readFileSync(new URL('../src/apple-ui.css', import.meta.url), 'utf8')
  const base = readFileSync(new URL('../src/demo.css', import.meta.url), 'utf8')
  assert.match(css, /\.generation-spinner\s*\{[^}]*animation: spin 1s linear infinite/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.generation-spinner\s*\{ animation: none;/)
  assert.match(base, /@keyframes spin\{to\{transform:rotate\(360deg\)\}\}/)
  assert.doesNotMatch(css, /elapsed-time|waiting-message|waiting-provider/)
})
test('web loading uses only the new spinner and retains real cancellation without artificial rule delays', () => {
  const app = readFileSync(new URL('../src/demo-main.jsx', import.meta.url), 'utf8')
  assert.match(app, /<GenerationProgress mode=\{mode\} \/>/)
  assert.doesNotMatch(app, /className="spark-loader"/)
  assert.match(app, /onClick=\{cancelGeneration\}/)
  assert.doesNotMatch(app, /setTimeout\(resolve/)
})
test('native low setting and compact prompts stay intact with a timer-free indeterminate wheel', () => {
  const native = file => readFileSync(new URL(`../android/app/src/main/java/com/ideaassist/app/${file}.kt`, import.meta.url), 'utf8')
  assert.match(native('GeminiApi'), /put\("thinkingLevel","low"\)/)
  assert.match(native('GeminiApi'), /put\("maxOutputTokens",4096\)/)
  assert.match(native('AiEngine'), /val examplePrefix = if\(compactCloud\) ""/)
  assert.match(native('AiEngine'), /description은 60~160자 두 문장/)
  assert.doesNotMatch(native('AppSession'), /startedAt/)
  assert.doesNotMatch(native('MainActivity'), /waitingHandler|waitingTick|elapsedText|경과 시간|GenerationFeedback/)
  assert.match(native('MainActivity'), /val spinner = ProgressBar\(this\)\.apply\s*\{\s*isIndeterminate = true/)
  assert.match(native('MainActivity'), /LinearLayout.LayoutParams\(dp\(48\), dp\(48\)\).*gravity=Gravity.CENTER_HORIZONTAL/)
  assert.match(native('MainActivity'), /"작업 취소"\) \{ session.cancel\(\) \}/)
})
