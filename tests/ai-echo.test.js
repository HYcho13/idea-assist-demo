import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMessages, validateOutput, makeResult } from '../src/demo/ai-contract.js'

const output = { title: '추억 콩 자전거 카트', one_liner: '자전거 카트에서 콩 디저트를 제공하는 작은 시식 서비스입니다.', description: '콩 디저트를 담은 카트를 자전거로 옮깁니다. 추억 사진 카드를 곁들여 동네에서 시식합니다.', steps: ['콩 디저트 한 가지를 준비해 맛을 확인합니다.', '자전거에 고정할 작은 상자를 시험합니다.', '추억 카드와 시제품을 세 명에게 보여줍니다.'], word_links: { material: '콩을 디저트의 중심 재료로 사용합니다.', method: '자전거를 시제품 운반 수단으로 사용합니다.', mood: '추억 사진 카드를 포장에 곁들입니다.' } }
const args = { categoryId: 'food', category: '음식 개발', words: ['콩', '자전거', '추억'], condition: '작게 시작하기' }
const current = makeResult(output, args, 'webllm', 'test-model')

test('development sends core model description without UI-added word-link footer', () => {
  const messages = buildMessages({ ...args, type: 'develop', current, direction: '더 현실적으로' })
  assert.equal(messages.at(-1).content.includes('세 단어의 연결'), false)
})
test('decorated echo cannot count as a successful development', () => {
  assert.throws(() => validateOutput({ ...output, title: '표현만 바뀐 제목', description: current.description }, 'develop', current), /그대로 반복/)
})
test('rendering model echo adds the word-link footer exactly once', () => {
  const rendered = makeResult({ ...output, description: current.description }, args, 'webllm', 'test-model')
  assert.equal(rendered.description.split('세 단어의 연결').length - 1, 1)
})

test('a paraphrased description with identical actions is not a development', () => {
  assert.throws(() => validateOutput({ ...output, description: '자전거에 콩 디저트 카트를 연결합니다. 동네에서 추억 카드와 함께 시식하는 서비스입니다.' }, 'develop', current), /실행 단계/)
})
