import test from 'node:test'
import assert from 'node:assert/strict'
import { makeResult } from '../src/demo/ai-contract.js'

const args = { categoryId: 'food', category: '음식 개발', words: ['콩', '자전거', '추억'], condition: '작게 시작하기' }
const output = { title: '추억 콩 자전거 카트', one_liner: '콩 디저트를 자전거 카트에서 제공하는 시식 서비스입니다.', description: '콩 디저트를 담은 카트를 자전거로 옮깁니다. 추억 사진 카드를 곁들여 시식 경험을 만듭니다.', steps: ['콩 디저트 한 가지를 만들어 시식합니다.', '자전거 상자와 전달 동선을 시험합니다.', '추억 카드와 시제품을 세 명에게 보여줍니다.'], word_links: { material: '콩을 디저트의 중심 재료로 사용합니다.', method: '자전거를 시제품 운반 수단으로 사용합니다.', mood: '추억 사진 카드를 포장에 곁들입니다.' } }

test('actual word-link mismatch cannot masquerade as the chosen material', () => {
  assert.throws(() => makeResult({ ...output, word_links: { ...output.word_links, material: '콘을 디저트의 중심 재료로 사용합니다.' } }, args, 'webllm', 'test-model'), /입력 단어/)
})

test('correct word links preserve the real AI source', () => {
  assert.equal(makeResult(output, args, 'webllm', 'test-model').source, 'webllm')
})
