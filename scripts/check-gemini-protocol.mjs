// No credentials are read or sent. This checks request decoding, NOT model inference.
import assert from 'node:assert/strict'
import { GEMINI_ENDPOINT, geminiRequest } from '../src/demo/gemini-ai.js'
import { composeIdea } from '../src/demo/domain.js'

const args = { categoryId: 'food', category: '음식 개발', words: ['딸기', '자전거', '구름'], condition: '작게 시험하기' }
const current = composeIdea(args)
async function probe(body) {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    credentials: 'omit', redirect: 'error', cache: 'no-store',
  })
  const payload = await response.json()
  return { http: response.status, status: payload?.error?.status }
}

const invalid = geminiRequest({ ...args, type: 'generate' })
invalid.generationConfig.responseFormat.text.mimeType = 'application/json'
const rejected = await probe(invalid)
assert.deepEqual(rejected, { http: 400, status: 'INVALID_ARGUMENT' })
console.log('PASS: old MIME literal reproduces HTTP 400 / INVALID_ARGUMENT')
for (const type of ['generate', 'develop', 'elaborate']) {
  const result = await probe(geminiRequest({ ...args, type, ...(type !== 'generate' ? { current, direction: '더 현실적으로' } : {}) }))
  assert.deepEqual(result, { http: 403, status: 'PERMISSION_DENIED' })
  console.log(`PASS: ${type} request decodes and reaches authentication (no key supplied)`)
}
console.log('No API key used. No successful inference, account access, or quota verified.')
