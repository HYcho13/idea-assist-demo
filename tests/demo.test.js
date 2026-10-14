import test from 'node:test'
import assert from 'node:assert/strict'
import { drawWords, composeIdea, developIdea, elaborateIdea, validateIdea } from '../src/demo/domain.js'
import { freshLibrary, readLibrary, writeLibrary, saveRecord, validateLibrary } from '../src/demo/storage.js'

test('리롤은 고정된 단어와 슬롯을 유지하며 중복 없이 교체한다', () => {
  for (const id of ['food', 'program', 'contest']) {
    for (let n = 0; n < 100; n++) {
      const first = drawWords(id).words
      const next = drawWords(id, { current: first, locked: [1, 2] }).words
      assert.equal(next[1], first[1]); assert.equal(next[2], first[2]); assert.notEqual(next[0], first[0])
      assert.equal(new Set(next).size, 3)
    }
  }
})
test('내 단어를 1~2개 적용하고 과도한 고정과 중복을 거부한다', () => {
  const drawn = drawWords('food', { custom: ['커피', '컵'] })
  assert.deepEqual(drawn.words.slice(0, 2), ['커피', '컵'])
  assert.equal(drawn.words.length, 3)
  assert.throws(() => drawWords('food', { custom: ['커피', '커피'] }))
  assert.throws(() => drawWords('food', { custom: ['a', 'b', 'c'] }))
  assert.throws(() => drawWords('food', { current: ['a', 'b', 'c'], locked: [0, 1, 2] }))
})
test('생성·발전·구체화에서 세 단어가 반영되고 문장이 누적되지 않는다', () => {
  for (const categoryId of ['food', 'program', 'contest']) {
    const { words, condition } = drawWords(categoryId)
    const idea = composeIdea({ categoryId, words, condition })
    const unique = composeIdea({ categoryId, words, condition, variant: 1 })
    assert.notEqual(idea.description, unique.description)
    let next = idea
    for (let n = 0; n < 10; n++) next = developIdea(next, 'realistic')
    assert.equal(next.description, developIdea(idea, 'realistic').description)
    assert.equal(next.id, idea.id)
    assert.equal(validateIdea(next, words), next)
    assert.equal(elaborateIdea(next).core_features.length, 3)
  }
})
test('같은 아이디어 재저장은 중복 없이 갱신하며 JSON 왕복 후 보관함이 유지된다', () => {
  const idea = composeIdea({ categoryId: 'food', words: ['김치', '자전거', '구름'], condition: '작게 시험하기' })
  const first = saveRecord(freshLibrary(), idea, { name: '첫 생각', folderId: 'default' })
  const second = saveRecord(first, { ...idea, revision: 2 }, { name: '수정한 생각', folderId: 'default' })
  assert.equal(second.ideas.length, 1)
  const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) }
  writeLibrary(second, storage)
  assert.equal(readLibrary(storage).library.ideas[0].name, '수정한 생각')
  assert.equal(readLibrary(storage).library.ideas[0].revision, 2)
})
test('손상된 저장소와 저장 불가 상황에 거짓 성공을 반환하지 않는다', () => {
  const broken = { getItem: () => '{broken' }
  assert.ok(readLibrary(broken).error)
  assert.throws(() => writeLibrary(freshLibrary(), { setItem: () => { throw new Error('Quota exceeded') } }))
  assert.throws(() => validateLibrary({ version: 1, folders: [], customWords: [], ideas: [{ id: 'bad' }] }))
})
