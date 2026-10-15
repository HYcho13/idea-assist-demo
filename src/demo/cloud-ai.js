import { buildMessages, schemaFor, parseOutput, makeResult, withCancellation } from './ai-contract.js'

export const CLOUD_MODEL = 'gpt-4.1-mini'
export const CLOUD_ENDPOINT = 'https://api.openai.com/v1/responses'

function httpError(status, code) {
  if (status === 401) return '클라우드 API 키 인증에 실패했어요. 개인 키를 확인해 주세요.'
  if (status === 403) return '클라우드 모델 접근 권한이 없어요. 프로젝트와 모델 권한을 확인해 주세요.'
  if (status === 429) return code === 'insufficient_quota' ? '클라우드 사용 한도 또는 크레딧이 부족해요. OpenAI 결제와 사용 한도를 확인해 주세요.' : '클라우드 요청 한도를 초과했어요. 잠시 후 다시 시도하거나 사용 한도를 확인해 주세요.'
  if (status >= 500) return 'OpenAI 서비스 오류예요. 잠시 후 다시 시도해 주세요.'
  return `클라우드 요청이 거절됐어요 (HTTP ${status}). 모델과 계정 설정을 확인해 주세요.`
}

// The key is supplied for this call only; never persist or return transport data.
export async function cloudGenerate(args, { apiKey, signal, fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('설정에서 개인 OpenAI API 키를 입력해 주세요.')
  if (/[\r\n]/.test(apiKey)) throw new Error('API 키 형식을 확인해 주세요.')
  const messages = buildMessages(args)
  return withCancellation(async requestSignal => {
    let response
    try {
      response = await fetchImpl(CLOUD_ENDPOINT, {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        signal: requestSignal,
        body: JSON.stringify({
          model: CLOUD_MODEL, store: false, input: messages, max_output_tokens: 1600,
          text: { format: { type: 'json_schema', name: args.type === 'elaborate' ? 'idea_detail' : 'idea', strict: true, schema: schemaFor(args.type) } },
        }),
      })
    } catch {
      throw new Error('클라우드에 연결하지 못했어요. 인터넷 연결 또는 브라우저 CORS 차단을 확인해 주세요. 자동으로 시연 결과를 만들지 않습니다.')
    }
    let payload
    try { payload = await response.json() } catch {
      if (!response.ok) throw new Error(httpError(response.status))
      throw new Error('클라우드 응답 형식을 읽지 못했어요. 다시 시도해 주세요.')
    }
    if (!response.ok) throw new Error(httpError(response.status, payload?.error?.code))
    if (!Array.isArray(payload?.output)) throw new Error('클라우드 응답 내용을 읽지 못했어요. 다시 시도해 주세요.')
    if (payload.output.some(item => Array.isArray(item?.content) && item.content.some(part => part?.type === 'refusal'))) throw new Error('클라우드 AI가 요청을 거절했어요. 입력을 바꾸어 주세요.')
    if (payload?.status !== 'completed' || payload?.error) throw new Error('클라우드 응답이 끝까지 완성되지 않았어요. 다시 시도해 주세요.')
    const outputMessages = payload.output.filter(item => item?.type === 'message' && item.role === 'assistant')
    if (!outputMessages.length || outputMessages.some(item => item.status !== 'completed')) throw new Error('클라우드 응답이 끝까지 완성되지 않았어요. 다시 시도해 주세요.')
    if (outputMessages.some(item => !Array.isArray(item.content))) throw new Error('클라우드 응답 내용을 읽지 못했어요. 다시 시도해 주세요.')
    const parts = outputMessages.flatMap(item => item.content)
    if (!parts.length || parts.some(part => part?.type !== 'output_text' || typeof part.text !== 'string')) throw new Error('클라우드 응답 내용을 읽지 못했어요. 다시 시도해 주세요.')
    return makeResult(parseOutput(parts.map(part => part.text).join(''), args.type, args.current || args.previous), args, 'cloud', CLOUD_MODEL)
  }, { signal, timeoutMs })
}
