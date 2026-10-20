import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { wordPools } from '../src/demo/data.js'
import { drawWords, composeIdea, validateIdea } from '../src/demo/domain.js'

test('each category has 100 distinct curated words split into 34/33/33 roles', () => {
  for (const pools of Object.values(wordPools)) {
    assert.deepEqual(pools.map(pool => pool.length), [34, 33, 33])
    assert.equal(new Set(pools.flat()).size, 100)
    for (const word of pools.flat()) assert.ok(word.trim() === word && word.length > 0 && word.length <= 12)
  }
})

test('Android embeds the exact same ordered word pools as the web', () => {
  const native = readFileSync(new URL('../android/app/src/main/java/com/ideaassist/app/DemoDomain.kt', import.meta.url), 'utf8')
  for (const [id, pools] of Object.entries(wordPools)) {
    const line = native.split('\n').find(line => line.includes(`"${id}" to listOf(`))
    assert.ok(line, id)
    const nativePools = [...line.matchAll(/listOf\(([^()]*)\)/g)].map(match => [...match[1].matchAll(/"([^"]+)"/g)].map(word => word[1]))
    assert.deepEqual(nativePools, pools)
  }
})

test('every expanded word is reachable and composes a valid rules result', () => {
  for (const [categoryId, pools] of Object.entries(wordPools)) {
    for (let role = 0; role < 3; role++) {
      for (let index = 0; index < pools[role].length; index++) {
        const { words, condition } = drawWords(categoryId, { random: () => (index + 0.5) / pools[role].length })
        assert.equal(words[role], pools[role][index])
        assert.equal(new Set(words).size, 3)
        assert.ok(validateIdea(composeIdea({ categoryId, words, condition }), words))
        const rerolled = drawWords(categoryId, { current: words, locked: [role] }).words
        assert.equal(rerolled[role], words[role])
        for (let other = 0; other < 3; other++) if (other !== role) assert.notEqual(rerolled[other], words[other])
      }
    }
  }
})
