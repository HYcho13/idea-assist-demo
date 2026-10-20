import { buildMessages, schemaFor, parseOutput, makeResult, withCancellation } from './ai-contract.js'
import { normalizeGeminiKey } from './gemini-key.js'

export const GEMINI_MODEL = 'gemini-3.8-flash'
export const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
export const GEMINI_MODEL_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`
// Classify known provider signals only. Never expose the raw response (it may echo a key/input).
export function geminiError(status, payload) {
  const error = payload?.error
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : ''
  const details = Array.isArray(error?.details) ? error.details : []
  const reasons = details.map(item => item?.reason)
  const suffix = ` (HTTP ${status}).`
  if (message.includes('api key expired')) return 'Google이 API 키 만료를 응답했어요. AI Studio에서 키 상태를 확인하고 사용 가능한 전체 키를 다시 입력해 주세요. [API_KEY_INVALID]' + suffix
  if (reasons.includes('API_KEY_INVALID') || message.includes('api key not valid')) return 'Google이 유효하지 않은 API 키로 거절했어요. 전체 키 복사 여부와 AI Studio의 키 상태를 확인해 주세요. 코드 변경으로 키 인증을 우회할 수는 없어요. [API_KEY_INVALID]' + suffix
  if (message.includes('reported as leaked')) return 'Google Gemini가 노출된 키의 사용을 차단했어요. AI Studio에서 새 키를 발급하고 기존 키를 폐기해 주세요.' + suffix
  if (reasons.includes('SERVICE_DISABLED')) return 'Google Gemini API가 이 프로젝트에서 비활성화돼 있어요. Google Cloud에서 Generative Language API 설정을 확인해 주세요.' + suffix
  if (reasons.some(reason => ['API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_ANDROID_APP_BLOCKED', 'API_KEY_IOS_APP_BLOCKED'].includes(reason))) return 'Google Gemini 키의 API 또는 앱·웹 사용 제한이 현재 실행 환경과 맞지 않아요. 키의 제한 설정을 확인해 주세요.' + suffix
  if (reasons.includes('BILLING_DISABLED') || error?.status === 'FAILED_PRECONDITION') return 'Google Gemini 계정·프로젝트의 사용 조건을 충족하지 못했어요. 이용 지역, 무료 이용 대상과 결제 상태를 확인해 주세요.' + suffix
  if (status === 400) return 'Google Gemini 요청 형식 또는 모델 옵션이 거절됐어요. 키 오류로 단정할 수 없어요. 최신 앱인지 확인해 주세요.' + suffix
  if (status === 401) return 'Google Gemini 키 인증에 실패했어요. 선택한 제공업체와 개인 키를 확인해 주세요.' + suffix
  if (status === 403) return 'Google Gemini 접근이 거부됐어요. 키의 사용 제한과 프로젝트·API 권한을 확인해 주세요.' + suffix
  if (status === 429) return 'Google Gemini 요청 한도 또는 사용량 한도를 초과했어요. 계정 한도를 확인해 주세요.'
  if (status === 404) return 'Google Gemini 모델을 이 프로젝트에서 사용할 수 없어요. 모델 접근 권한을 확인해 주세요.'
  return `Google Gemini 서비스 요청 실패 (HTTP ${status}). 잠시 후 다시 시도해 주세요.`
}
export function geminiRequest(args) {
  const messages = buildMessages({ ...args, compact: true })
  return {
    systemInstruction: { parts: [{ text: messages[0].content }] },
    contents: [{ role: 'user', parts: [{ text: messages.at(-1).content }] }],
    // TextResponseFormat.MimeType is a protobuf enum, not a MIME string.
    generationConfig: { thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: 4096, responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: schemaFor(args.type) } } },
  }
}
export function parseGemini(payload) {
  if (payload?.error || payload?.promptFeedback?.blockReason) throw new Error('Google Gemini가 요청을 거절했어요. 입력이나 계정 설정을 확인해 주세요.')
  const candidate = payload?.candidates?.[0]
  if (!candidate || candidate.finishReason !== 'STOP' || !Array.isArray(candidate.content?.parts)) throw new Error('Google Gemini 응답이 끝까지 완성되지 않았어요. 다시 시도해 주세요.')
  const parts = candidate.content.parts.filter(part => part.thought !== true)
  if (!parts.length || parts.some(part => typeof part.text !== 'string')) throw new Error('Google Gemini 응답 내용을 읽지 못했어요.')
  return parts.map(part => part.text).join('')
}
export async function geminiGenerate(args, { apiKey, signal, fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('설정에서 Google Gemini 개인 API 키를 입력해 주세요.')
  const key = normalizeGeminiKey(apiKey)
  const body = geminiRequest(args)
  return withCancellation(async requestSignal => {
    let response
    try {
      response = await fetchImpl(GEMINI_ENDPOINT, {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: requestSignal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      })
    } catch { throw new Error('Google Gemini에 연결하지 못했어요. 인터넷 또는 브라우저 CORS 차단을 확인해 주세요. 시연 결과로 자동 대체하지 않습니다.') }
    let payload
    try { payload = await response.json() } catch {
      if (!response.ok) throw new Error(geminiError(response.status))
      throw new Error('Google Gemini 응답 형식을 읽지 못했어요.')
    }
    if (!response.ok) throw new Error(geminiError(response.status, payload))
    return makeResult(parseOutput(parseGemini(payload), args.type, args.current || args.previous), args, 'gemini', GEMINI_MODEL)
  }, { signal, timeoutMs })
}
// Explicit user action only. Model metadata verifies authentication, not inference/quota.
export async function geminiVerifyKey({ apiKey, signal, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const key = normalizeGeminiKey(apiKey)
  return withCancellation(async requestSignal => {
    let response
    try {
      response = await fetchImpl(GEMINI_MODEL_ENDPOINT, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: requestSignal, headers: { 'x-goog-api-key': key } })
    } catch { throw new Error('Google Gemini 연결 확인에 실패했어요. 인터넷 또는 브라우저 CORS 차단을 확인해 주세요.') }
    let payload
    try { payload = await response.json() } catch {
      if (!response.ok) throw new Error(geminiError(response.status))
      throw new Error('Google Gemini 모델 정보를 읽지 못했어요.')
    }
    if (!response.ok) throw new Error(geminiError(response.status, payload))
    if (payload?.name !== `models/${GEMINI_MODEL}` && payload?.baseModelId !== GEMINI_MODEL) throw new Error('Google Gemini 모델 정보를 확인하지 못했어요.')
    return '키 인증·모델 정보 조회 성공. 실제 생성과 사용량 한도는 별도 확인이 필요해요.'
  }, { signal, timeoutMs })
}
