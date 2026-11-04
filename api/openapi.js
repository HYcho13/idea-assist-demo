import { ideaSchema, detailSchema } from '../src/demo/ai-contract.js'

const ref = name => ({ $ref: `#/components/schemas/${name}` })
const json = schema => ({ 'application/json': { schema } })
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required })
const string = { type: 'string' }
const id = { type: 'string', format: 'uuid' }
const key = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' }
const direction = { type: 'string', enum: ['unique', 'realistic', 'fun', 'premium'] }
const source = { type: 'string', enum: ['gemini', 'cloud', 'local'] }
const words = { type: 'array', minItems: 3, maxItems: 3, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 12 } }
const envelope = data => object({ data, meta: ref('Meta') })
const responses = data => ({
  200: { description: '완성된 결과. 동일 요청 키의 성공 결과는 재호출 없이 재전송.', content: json(envelope(data)) },
  ...Object.fromEntries([400, 401, 403, 404, 405, 409, 413, 415, 429, 500, 502, 503, 504].map(status => [status, { description: '안전한 오류. 기존 결과를 변경하지 않음.', content: json(ref('Error')) }])),
})
const body = schema => ({ required: true, content: json(schema) })
const sessionId = { in: 'path', name: 'id', required: true, schema: id }
const idem = { in: 'header', name: 'Idempotency-Key', required: true, schema: key,
  description: '논리 요청마다 새 키. 같은 키·본문은 모델을 재호출하지 않음. 다른 본문에 재사용하면 409.' }
const secured = { security: [{ sessionToken: [] }], parameters: [sessionId] }
const action = (summary, requestSchema, data) => ({
  post: { ...secured, summary, parameters: [sessionId, idem], requestBody: body(requestSchema), responses: responses(data) },
})
const ideaFields = {
  ...ideaSchema.properties, id, categoryId: { enum: ['food', 'program', 'contest', 'custom'], type: 'string' }, category: string,
  topic: string, condition: { type: 'string', maxLength: 100 }, used_words: words, source, model: string,
  revision: { type: 'integer', minimum: 1 }, parentIdeaId: id, direction, what_changed: { type: 'string', minLength: 8, maxLength: 500 },
}
const ideaRequired = [...ideaSchema.required, 'id', 'categoryId', 'category', 'condition', 'used_words', 'source', 'model', 'revision']
const detailFields = { ...detailSchema.properties, ideaId: id, revision: { type: 'integer', minimum: 1 }, source, model: string }
const sessionFields = { id, categoryId: ideaFields.categoryId, category: string, topic: string, words,
  condition: ideaFields.condition, currentIdeaId: { anyOf: [id, { type: 'null' }] },
  ideas: { type: 'array', items: ref('StoredIdea') }, pendingRequestKey: { anyOf: [key, { type: 'null' }] }, expiresAt: { type: 'string', format: 'date-time' } }

export const openapi = {
  openapi: '3.1.0', info: { title: '아이디어 보조 생성 세션 API', version: '1.0.0',
    description: '2026-10-28 추가 명세 구현. 로컬 단일 프로세스·메모리 저장. 기존 Render 정적 웹/Android는 이 API에 자동 연결되지 않는다. 세션 토큰은 소유 증명이며 회원 인증이 아니다.' },
  servers: [{ url: 'http://127.0.0.1:4000' }],
  paths: {
    '/v1/health': { get: { summary: '프로세스 상태 (실제 AI 인증/생성 성공을 뜻하지 않음)', responses: { 200: { description: '상태', content: json(envelope(object({ status: { const: 'ok' }, source, model: string, persistence: { const: 'memory' } }))) } } } },
    '/v1/openapi.json': { get: { summary: '이 API 명세 JSON', responses: { 200: { description: 'OpenAPI 3.1 문서' } } } },
    '/v1/generation-sessions': { post: { summary: '생성 세션 준비. AI 호출 없음. sessionToken은 이 응답에서만 제공.', requestBody: body(ref('CreateSession')),
      responses: { ...responses(ref('CreatedSession')), 201: { description: '세션 생성', content: json(envelope(ref('CreatedSession'))) } } } },
    '/v1/generation-sessions/{id}': { get: { ...secured, summary: '컨텍스트·기존 결과·진행 요청 조회', responses: responses(ref('Session')) } },
    '/v1/generation-sessions/{id}/generate': action('첫 아이디어 생성', object({}), ref('Idea')),
    '/v1/generation-sessions/{id}/regenerate': action('단어·카테고리·주제·조건을 유지하고 다른 아이디어 생성', object({ ideaId: id }), ref('Idea')),
    '/v1/generation-sessions/{id}/develop': action('현재 아이디어 핵심을 선택 방향으로 발전', object({ ideaId: id, direction }), ref('DevelopedIdea')),
    '/v1/generation-sessions/{id}/elaborate': action('실행 초안 구체화. 재요청에는 다른 첫 실험 방법 요구', object({ ideaId: id }), ref('Elaboration')),
    '/v1/generation-sessions/{id}/cancel': { post: { ...secured, summary: '진행 중인 요청 취소. 중복 취소는 cancelled:false', requestBody: body(object({ requestKey: key })), responses: responses(object({ cancelled: { type: 'boolean' } })) } },
  },
  components: {
    securitySchemes: { sessionToken: { type: 'http', scheme: 'bearer', description: '세션 생성 응답의 sessionToken. 모델 업체 API 키와 다름.' } },
    schemas: {
      Meta: object({ requestId: id, replayed: { type: 'boolean' } }),
      Error: object({ error: object({ code: string, message: string }), meta: ref('Meta') }),
      CreateSession: object({ categoryId: ideaFields.categoryId, topic: { type: 'string', minLength: 1, maxLength: 80 }, words,
        condition: { type: 'string', maxLength: 100, default: '' } }, ['categoryId']),
      Idea: object(ideaFields, ideaRequired),
      DevelopedIdea: object(ideaFields, [...ideaRequired, 'direction', 'what_changed', 'parentIdeaId']),
      Elaboration: object(detailFields),
      StoredIdea: object({ ...ideaFields, elaboration: ref('Elaboration') }, ideaRequired),
      Session: object(sessionFields),
      CreatedSession: object({ ...sessionFields, sessionToken: { type: 'string', minLength: 43, maxLength: 43, writeOnly: false } }),
    },
  },
}
