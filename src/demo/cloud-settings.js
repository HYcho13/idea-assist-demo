// Non-secret, provider-specific acknowledgement only. Never pass credentials here.
import { normalizeGeminiKey } from './gemini-key.js'
export const CONSENT_VERSION = 1
const prefix = `idea-assist-cloud-consent-v${CONSENT_VERSION}-`
export const providerName = provider => provider === 'gemini' ? 'Google Gemini' : 'OpenAI'
export function validProvider(provider) { return provider === 'openai' || provider === 'gemini' }
export function readCloudProvider(storage = globalThis.localStorage) {
  try { const value=storage.getItem('idea-assist-cloud-provider-v1'); return validProvider(value) ? value : 'openai' } catch { return 'openai' }
}
export function saveCloudProvider(provider, storage = globalThis.localStorage) {
  if (!validProvider(provider)) throw new Error('AI 제공업체를 선택해 주세요.')
  try { storage.setItem('idea-assist-cloud-provider-v1',provider) } catch { throw new Error('제공업체 설정을 저장하지 못했어요. 다시 시도해 주세요.') }
}
export function readConsent(provider, storage = globalThis.localStorage) {
  if (!validProvider(provider)) return false
  try { return storage.getItem(prefix + provider) === 'accepted' } catch { return false }
}
export function saveConsent(provider, accepted, storage = globalThis.localStorage) {
  if (!validProvider(provider) || accepted !== true) throw new Error('선택한 제공업체의 전송·API 비용 안내에 동의해 주세요.')
  try { storage.setItem(prefix + provider, 'accepted') } catch { throw new Error('동의 설정을 저장하지 못했어요. 브라우저 저장소 설정을 확인해 주세요.') }
}
export function validateCloudSettings(provider, key, accepted) {
  if (!validProvider(provider)) throw new Error('AI 제공업체를 선택해 주세요.')
  const clean = provider === 'gemini' ? normalizeGeminiKey(key) : key
  if (provider !== 'gemini' && (typeof key !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(key.trim()))) throw new Error('본인의 개인 API 키를 입력하고 형식을 확인해 주세요.')
  if (accepted !== true) throw new Error('선택한 제공업체의 전송·API 비용 안내에 동의해 주세요.')
  return clean.trim()
}
