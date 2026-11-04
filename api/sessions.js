import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto'
import { categories, directions } from '../src/demo/data.js'
import { drawWords, normalize } from '../src/demo/domain.js'
import { validateCondition } from '../src/demo/condition.js'
import { validateOutput, makeResult, coreDescription } from '../src/demo/ai-contract.js'
import { ApiError, fail, publicError } from './errors.js'

const hash = value => createHash('sha256').update(value).digest()
const normalized = value => value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
export function objectBody(body, allowed, required = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(body, key))) {
    fail(400, 'INVALID_BODY', '요청 필드가 명세와 다릅니다.')
  }
}
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, 'INVALID_INPUT', `${label} 입력을 확인해 주세요.`)
  try { validateCondition(value) } catch { fail(400, 'INVALID_INPUT', `${label}에 사용할 수 없는 문자가 있습니다.`) }
  return normalize(value)
}

// Single-process, bounded, expiring storage. This is not a persistent database.
export class GenerationSessions {
  constructor({ generator, timeoutMs = 60000, ttlMs = 3600000, maxSessions = 100, maxConcurrency = 4, maxRequests = 100, now = Date.now } = {}) {
    this.generator = generator
    this.timeoutMs = timeoutMs
    this.ttlMs = ttlMs
    this.maxSessions = maxSessions
    this.maxConcurrency = maxConcurrency
    this.maxRequests = maxRequests
    this.now = now
    this.sessions = new Map()
    this.active = 0
    this.recent = []
  }
  prune() {
    for (const [id, session] of this.sessions) if (!session.pending && session.expiresAt <= this.now()) this.sessions.delete(id)
  }
  create(body) {
    objectBody(body, ['categoryId', 'topic', 'words', 'condition'], ['categoryId'])
    const category = categories.find(item => item.id === body.categoryId)
    if (!category && body.categoryId !== 'custom') fail(400, 'INVALID_CATEGORY', '카테고리를 확인해 주세요.')
    const topic = body.topic === undefined ? '' : text(body.topic, 80, '주제')
    if (body.categoryId === 'custom' && !topic) fail(400, 'INVALID_TOPIC', '직접 입력 주제가 필요합니다.')
    let condition
    try { condition = validateCondition(body.condition) } catch { fail(400, 'INVALID_CONDITION', '조건은 제어문자 없이 최대 100자로 입력해 주세요.') }
    const words = body.words === undefined ? drawWords(body.categoryId).words : body.words
    if (!Array.isArray(words) || words.length !== 3) fail(400, 'INVALID_WORDS', '서로 다른 단어 3개가 필요합니다.')
    const cleanWords = words.map(word => text(word, 12, '단어'))
    if (new Set(cleanWords).size !== 3) fail(400, 'INVALID_WORDS', '서로 다른 단어 3개가 필요합니다.')
    this.prune()
    if (this.sessions.size >= this.maxSessions) fail(503, 'SESSION_CAPACITY', '세션 한도에 도달했습니다. 만료 후 다시 시도해 주세요.')
    const token = randomBytes(32).toString('base64url')
    const session = { id: randomUUID(), tokenHash: hash(token), categoryId: body.categoryId, category: category?.name || topic,
      topic, words: cleanWords, condition, currentIdeaId: null, ideas: new Map(), requests: new Map(), pending: null, expiresAt: this.now() + this.ttlMs }
    this.sessions.set(session.id, session)
    return { ...this.view(session), sessionToken: token }
  }
  authorize(id, authorization) {
    this.prune()
    const session = this.sessions.get(id)
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization || '')?.[1]
    if (!token) fail(401, 'SESSION_TOKEN_REQUIRED', '이 세션의 Bearer 토큰이 필요합니다.')
    if (!session || !timingSafeEqual(session.tokenHash, hash(token))) fail(404, 'SESSION_NOT_FOUND', '세션을 찾을 수 없거나 접근 권한이 없습니다.')
    return session
  }
  view(session) {
    return structuredClone({ id: session.id, categoryId: session.categoryId, category: session.category, topic: session.topic,
      words: session.words, condition: session.condition, currentIdeaId: session.currentIdeaId,
      ideas: [...session.ideas.values()], pendingRequestKey: session.pending?.key || null, expiresAt: new Date(session.expiresAt).toISOString() })
  }
  cancel(session, body) {
    objectBody(body, ['requestKey'], ['requestKey'])
    if (typeof body.requestKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.requestKey)) fail(400, 'INVALID_REQUEST_KEY', '취소할 요청 키를 확인해 주세요.')
    const pending = session.pending
    if (!pending || pending.key !== body.requestKey) return { cancelled: false }
    pending.controller.abort()
    return { cancelled: true }
  }
  async run(session, action, body, key, signal) {
    if (!['generate', 'regenerate', 'develop', 'elaborate'].includes(action)) fail(404, 'NOT_FOUND', 'API 경로를 확인해 주세요.')
    objectBody(body, action === 'generate' ? [] : action === 'develop' ? ['ideaId', 'direction'] : ['ideaId'], action === 'generate' ? [] : action === 'develop' ? ['ideaId', 'direction'] : ['ideaId'])
    if (action !== 'generate' && (typeof body.ideaId !== 'string' || body.ideaId.length > 80)) fail(400, 'INVALID_IDEA', '아이디어 ID가 필요합니다.')
    if (action === 'develop' && !directions.some(item => item.id === body.direction)) fail(400, 'INVALID_DIRECTION', '발전 방향은 unique, realistic, fun, premium 중 하나입니다.')
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 헤더(영문·숫자·밑줄·하이픈, 1~128자)가 필요합니다.')
    const fingerprint = JSON.stringify([action, body.ideaId || null, body.direction || null])
    const prior = session.requests.get(key)
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', '같은 요청 키를 다른 요청에 재사용할 수 없습니다.')
      if (prior.state === 'pending') fail(409, 'REQUEST_IN_PROGRESS', '동일 요청을 처리 중입니다. 다시 호출하지 말고 기다려 주세요.')
      if (prior.error) throw prior.error
      return { data: structuredClone(prior.data), replayed: true }
    }
    if (session.pending) fail(409, 'SESSION_BUSY', '세션에서 다른 작업을 처리 중입니다.')
    if (signal?.aborted) fail(409, 'REQUEST_CANCELLED', '요청이 취소되었습니다. 기존 결과는 유지됩니다.')
    const current = action === 'generate' ? null : session.ideas.get(body.ideaId)
    if (action === 'generate' && session.currentIdeaId) fail(409, 'IDEA_ALREADY_EXISTS', '기존 결과가 있습니다. regenerate API를 사용해 주세요.')
    if (action !== 'generate' && !current) fail(404, 'IDEA_NOT_IN_SESSION', '해당 세션에 속한 아이디어가 아닙니다.')
    if (current && session.currentIdeaId !== current.id) fail(409, 'STALE_IDEA', '현재 아이디어 ID로 다시 요청해 주세요.')
    if (session.requests.size >= this.maxRequests) fail(429, 'SESSION_REQUEST_LIMIT', '세션의 요청 한도에 도달했습니다. 새 세션을 만들어 주세요.')
    if (this.active >= this.maxConcurrency) fail(429, 'SERVER_BUSY', '동시 AI 작업 한도에 도달했습니다.')
    this.recent = this.recent.filter(at => at > this.now() - 60000)
    if (this.recent.length >= 20) fail(429, 'RATE_LIMITED', '서버의 분당 생성 한도(20회)에 도달했습니다.')
    this.recent.push(this.now())
    const controller = new AbortController()
    const record = { key, fingerprint, state: 'pending', controller }
    session.requests.set(key, record)
    session.pending = record
    session.expiresAt = this.now() + this.ttlMs
    this.active++
    const type = action === 'regenerate' ? 'generate' : action
    const args = { categoryId: session.categoryId, category: session.category, topic: session.topic, words: [...session.words], condition: session.condition,
      type, current: type === 'generate' ? undefined : structuredClone(current), previous: action === 'regenerate' ? structuredClone(current) : undefined,
      directionId: body.direction, direction: directions.find(item => item.id === body.direction)?.label, variant: session.requests.size - 1 }
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    let timer, rejectAborted
    const aborted = new Promise((_, reject) => { rejectAborted = reject })
    const onAbort = () => rejectAborted(new ApiError(409, 'REQUEST_CANCELLED', '요청이 취소되었습니다. 기존 결과는 유지됩니다.'))
    controller.signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      rejectAborted(new ApiError(504, 'AI_TIMEOUT', 'AI 응답 시간이 초과되었습니다. 기존 결과는 유지됩니다.'))
      controller.abort()
    }, this.timeoutMs)
    try {
      const output = await Promise.race([aborted, Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new ApiError(409, 'REQUEST_CANCELLED', '요청이 취소되었습니다.')
        return this.generator.generate(args, { signal: controller.signal })
      })])
      if (controller.signal.aborted) fail(409, 'REQUEST_CANCELLED', '요청이 취소되었습니다. 기존 결과는 유지됩니다.')
      let data
      try {
        const { what_changed, ...ideaOutput } = output || {}
        const validated = validateOutput(type === 'develop' ? ideaOutput : output, type, current)
        if (type === 'elaborate') {
          if (current.elaboration && normalized(validated.first_prototype) === normalized(current.elaboration.first_prototype)) throw new Error('Repeated prototype')
          data = { ...validated, ideaId: current.id, revision: current.revision + 1, source: this.generator.source, model: this.generator.model }
        } else {
          if (action === 'regenerate' && (normalized(validated.title) === normalized(current.title) || normalized(coreDescription(validated.description)) === normalized(coreDescription(current.description)))) throw new Error('Repeated idea')
          if (type === 'develop' && (typeof what_changed !== 'string' || what_changed.trim().length < 8 || what_changed.length > 500)) throw new Error('Missing change explanation')
          data = makeResult(validated, args, this.generator.source, this.generator.model)
          data.id = randomUUID()
          data.revision = current ? current.revision + 1 : 1
          if (current) data.parentIdeaId = current.id
          if (type === 'develop') data.what_changed = what_changed.trim()
        }
      } catch { fail(502, 'AI_INVALID_RESPONSE', 'AI 결과가 불완전하거나 기존 결과를 반복했습니다. 기존 결과는 유지됩니다.') }
      // Commit only after a complete, validated result; errors/cancellation never mutate ideas.
      if (type === 'elaborate') session.ideas.set(current.id, { ...current, elaboration: data, revision: data.revision })
      else { session.ideas.set(data.id, data); session.currentIdeaId = data.id }
      record.data = structuredClone(data)
      return { data: structuredClone(data), replayed: false }
    } catch (error) {
      record.error = publicError(error)
      throw record.error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      controller.signal.removeEventListener('abort', onAbort)
      record.state = 'done'
      delete record.controller
      session.pending = null
      this.active--
      session.expiresAt = this.now() + this.ttlMs
    }
  }
  close() { for (const session of this.sessions.values()) session.pending?.controller.abort() }
}
