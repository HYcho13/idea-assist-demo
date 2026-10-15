import { normalize } from './domain.js'
export function validateTopic(value) {
  const topic = normalize(value)
  if (!topic || topic.length > 80) throw new Error('주제·분야를 1~80자로 입력해 주세요.')
  return topic
}
