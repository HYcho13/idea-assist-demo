// Shared UI/request validation. This does not replace a server trust boundary.
export const CONDITION_MAX_LENGTH = 100
const forbidden = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u
export function validateCondition(value = '') {
  if (typeof value !== 'string') throw new Error('조건은 글자로 입력해 주세요.')
  if (value.length > CONDITION_MAX_LENGTH) throw new Error('조건은 최대 100자까지 입력할 수 있어요.')
  if (forbidden.test(value) || /[\ud800-\udfff]/u.test(value.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) throw new Error('조건에 사용할 수 없는 제어문자가 있어요. 일반 글자로 다시 입력해 주세요.')
  return value.trim()
}
export function conditionError(value) {
  try { validateCondition(value); return '' } catch (error) { return error.message }
}
export function restoreCondition(value) {
  return typeof value === 'string' && !conditionError(value) ? value : ''
}
