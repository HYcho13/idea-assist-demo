import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createApiServer } from '../api/server.js'
import { createModel } from '../api/model.js'

// Self-contained, free, real HTTP smoke test. Never reads keys or contacts a provider.
const api = createApiServer({ generator: createModel({ provider: 'demo' }) })
api.server.listen(0, '127.0.0.1')
await once(api.server, 'listening')
const origin = `http://127.0.0.1:${api.server.address().port}`
let token, sessionPath
async function post(path, body) {
  const response = await fetch(origin + path, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) })
  const payload = await response.json()
  assert.ok(response.ok, `${path}: ${payload.error?.code}`)
  return payload.data
}
try {
  const session = await post('/v1/generation-sessions', { categoryId: 'food', words: ['김치', '도시락', '숲'], condition: '1인 가구를 위한 서비스' })
  token = session.sessionToken
  sessionPath = `/v1/generation-sessions/${session.id}`
  let idea = await post(`${sessionPath}/generate`, {})
  assert.equal(idea.source, 'local')
  const originalId = idea.id
  idea = await post(`${sessionPath}/regenerate`, { ideaId: idea.id })
  assert.notEqual(idea.id, originalId)
  idea = await post(`${sessionPath}/develop`, { ideaId: idea.id, direction: 'realistic' })
  assert.ok(idea.what_changed)
  const detail = await post(`${sessionPath}/elaborate`, { ideaId: idea.id })
  assert.equal(detail.core_features.length, 3)
  assert.equal(idea.condition, session.condition)
  assert.deepEqual(idea.used_words, session.words)
  console.log('API HTTP SMOKE PASS: 세션 → 생성 → 다시 생성 → 발전 → 구체화')
  console.log('명시적 규칙 시연 검증입니다. 실제 AI 호출·비용·키 사용은 없습니다.')
} finally {
  const closed = once(api.server, 'close')
  api.close()
  await closed
}
