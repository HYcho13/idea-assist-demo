import { buildMessages, schemaFor } from '../src/demo/ai-contract.js'
import { GEMINI_ENDPOINT, GEMINI_MODEL, geminiRequest, parseGemini } from '../src/demo/gemini-ai.js'
import { CLOUD_ENDPOINT, CLOUD_MODEL } from '../src/demo/cloud-ai.js'
import { composeIdea, developIdea, elaborateIdea } from '../src/demo/domain.js'
import { ApiError } from './errors.js'

export function outputSchema(type) {
  const schema = structuredClone(schemaFor(type))
  if (type === 'develop') {
    schema.properties.what_changed = { type: 'string' }
    schema.required.push('what_changed')
  }
  return schema
}

export function modelMessages(args) {
  const messages = buildMessages({ ...args, compact: true })
  if (args.type === 'develop') messages[0].content += ' what_changed에 기존 핵심을 유지하면서 실제로 바꾼 내용과 이유를 8~500자로 설명한다.'
  if (args.type === 'elaborate' && args.current?.elaboration) {
    messages.at(-1).content += `\n기존 구체화는 참고 데이터다. 첫 실험(first_prototype)은 기존과 다른 검증 방법으로 작성한다.\n${JSON.stringify({ previous_elaboration: args.current.elaboration })}`
  }
  return messages
}

// Explicit rule demo, never an automatic cloud fallback. No paid request is made here.
function demoOutput(args) {
  if (args.type === 'elaborate') {
    const detail = elaborateIdea(args.current)
    if (args.current.elaboration) detail.first_prototype = `${args.variant}차 실험: 사용자가 견본을 스스로 설명하게 하고, 관찰한 행동과 예상의 차이를 기록합니다.`
    return detail
  }
  const idea = args.type === 'develop' ? developIdea(args.current, args.directionId) : composeIdea(args)
  return {
    title: idea.title, one_liner: idea.one_liner, description: idea.description,
    steps: idea.steps,
    word_links: {
      material: `${args.words[0]} 단어를 핵심 소재로 사용합니다.`,
      method: `${args.words[1]} 단어를 이용 방식에 연결합니다.`,
      mood: `${args.words[2]} 단어를 분위기에 반영합니다.`,
    },
    ...(args.type === 'develop' ? { what_changed: idea.what_changed } : {}),
  }
}

export function createModel({ provider = 'gemini', apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (!['gemini', 'openai', 'demo'].includes(provider)) throw new Error('IDEA_API_PROVIDER must be gemini, openai or demo')
  return {
    source: { gemini: 'gemini', openai: 'cloud', demo: 'local' }[provider],
    model: { gemini: GEMINI_MODEL, openai: CLOUD_MODEL, demo: 'rules-demo' }[provider],
    async generate(args, { signal }) {
      if (provider === 'demo') return demoOutput(args)
      if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) {
        throw new ApiError(503, 'AI_NOT_CONFIGURED', '서버의 AI API 키 설정이 필요합니다. 규칙 결과로 자동 대체하지 않습니다.')
      }
      const messages = modelMessages(args)
      let body, endpoint, headers
      if (provider === 'gemini') {
        body = geminiRequest(args)
        body.systemInstruction.parts[0].text = messages[0].content
        body.contents[0].parts[0].text = messages.at(-1).content
        body.generationConfig.responseFormat.text.schema = outputSchema(args.type)
        endpoint = GEMINI_ENDPOINT
        headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() }
      } else {
        body = { model: CLOUD_MODEL, store: false, input: messages, max_output_tokens: 4096,
          text: { format: { type: 'json_schema', name: args.type, strict: true, schema: outputSchema(args.type) } } }
        endpoint = CLOUD_ENDPOINT
        headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` }
      }
      let response
      try {
        response = await fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error', cache: 'no-store' })
      } catch {
        throw new ApiError(502, 'AI_CONNECTION_FAILED', 'AI 제공업체에 연결하지 못했습니다.')
      }
      if (!response.ok) {
        const [code, message] = response.status === 429 ? ['AI_RATE_LIMITED', 'AI 사용량 또는 요청 한도를 확인해 주세요.']
          : [401, 403].includes(response.status) ? ['AI_AUTH_FAILED', '서버 AI 키 또는 모델 접근 권한을 확인해 주세요.']
            : ['AI_REQUEST_FAILED', 'AI 제공업체가 요청을 거절했습니다. 모델과 설정을 확인해 주세요.']
        await response.body?.cancel().catch(() => {})
        throw new ApiError(502, code, message)
      }
      try {
        const payload = await response.json()
        let content
        if (provider === 'gemini') content = parseGemini(payload)
        else {
          if (payload.status !== 'completed' || payload.error || !Array.isArray(payload.output)) throw new Error()
          const messages = payload.output.filter(item => item.type === 'message')
          if (!messages.length || messages.some(item => item.role !== 'assistant' || item.status !== 'completed' || !Array.isArray(item.content))) throw new Error()
          const parts = messages.flatMap(item => item.content)
          if (!parts.length || parts.some(part => part.type !== 'output_text' || typeof part.text !== 'string')) throw new Error()
          content = parts.map(part => part.text).join('')
        }
        return JSON.parse(content)
      } catch {
        throw new ApiError(502, 'AI_INVALID_RESPONSE', 'AI 응답이 거절되었거나 형식이 완성되지 않았습니다.')
      }
    },
  }
}
