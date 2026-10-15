import { buildMessages, schemaFor, parseOutput, makeResult, withCancellation } from './ai-contract.js'

export const GEMINI_MODEL = 'gemini-3.8-flash'
export const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
export function geminiError(status) {
  if ([400, 401, 403].includes(status)) return `Google Gemini 키·프로젝트·API 권한을 확인해 주세요 (HTTP ${status}).`
  if (status === 429) return 'Google Gemini 요청 한도 또는 사용량 한도를 초과했어요. 계정 한도를 확인해 주세요.'
  if (status === 404) return 'Google Gemini 모델을 이 프로젝트에서 사용할 수 없어요. 모델 접근 권한을 확인해 주세요.'
  return `Google Gemini 서비스 요청 실패 (HTTP ${status}). 잠시 후 다시 시도해 주세요.`
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
  if (!/^[\x21-\x7e]{1,512}$/.test(apiKey.trim())) throw new Error('API 키 형식을 확인해 주세요.')
  const messages = buildMessages(args)
  return withCancellation(async requestSignal => {
    let response
    try {
      response = await fetchImpl(GEMINI_ENDPOINT, {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: requestSignal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: messages[0].content }] },
          contents: [{ role: 'user', parts: [{ text: messages.at(-1).content }] }],
          generationConfig: { maxOutputTokens: 4096, responseFormat: { text: { mimeType: 'application/json', schema: schemaFor(args.type) } } },
        }),
      })
    } catch { throw new Error('Google Gemini에 연결하지 못했어요. 인터넷 또는 브라우저 CORS 차단을 확인해 주세요. 시연 결과로 자동 대체하지 않습니다.') }
    if (!response.ok) throw new Error(geminiError(response.status))
    let payload
    try { payload = await response.json() } catch { throw new Error('Google Gemini 응답 형식을 읽지 못했어요.') }
    return makeResult(parseOutput(parseGemini(payload), args.type, args.current || args.previous), args, 'gemini', GEMINI_MODEL)
  }, { signal, timeoutMs })
}
