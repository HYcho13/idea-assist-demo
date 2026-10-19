// Never infer validity from a prefix, and never log/return a key in an error.
export const GEMINI_KEY_LIMIT = 8192
export function normalizeGeminiKey(value) {
  if (typeof value !== 'string') throw new Error('Google AI Studio에서 복사한 전체 API 키를 입력해 주세요.')
  const key = value.replace(/^[\s\u200b\ufeff]+|[\s\u200b\ufeff]+$/gu, '')
  if (!key) throw new Error('Google AI Studio에서 복사한 전체 API 키를 입력해 주세요.')
  if (/^["'`]|["'`]$|^(?:Bearer\s|(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=|x-goog-api-key\s*:)/i.test(key)) throw new Error('따옴표·변수 이름·Bearer는 제외하고 API 키 값만 붙여넣어 주세요.')
  if (/\*{2,}|…|\.{3}|•/.test(key)) throw new Error('가려진 키나 생략된 키는 사용할 수 없어요. AI Studio의 복사 버튼으로 전체 키를 복사해 주세요.')
  if (key.length > GEMINI_KEY_LIMIT) throw new Error('API 키가 너무 길어요. 키 값 외의 설명이나 코드를 함께 복사하지 않았는지 확인해 주세요.')
  if (!/^[\x21-\x7e]+$/.test(key)) throw new Error('API 키 안에 공백·줄바꿈 또는 잘못된 문자가 있어요. 전체 키를 다시 복사해 주세요.')
  return key
}
