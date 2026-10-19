import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('word combination has no duplicate home action and keeps the bottom home tab', () => {
  const web = readFileSync(new URL('../src/demo-main.jsx', import.meta.url), 'utf8')
  const words = web.slice(web.indexOf("{screen === 'words' &&"), web.indexOf("{screen === 'custom' &&"))
  assert.ok(words.includes('이 조합으로 창조하기'))
  assert.doesNotMatch(words, /<Back|>홈</)
  assert.match(web, /aria-label="홈 탭"/)
  const native = readFileSync(new URL('../android/app/src/main/java/com/ideaassist/app/MainActivity.kt', import.meta.url), 'utf8')
  const nativeWords = native.slice(native.indexOf('private fun wordsScreen()'), native.indexOf('private fun customScreen()'))
  assert.ok(nativeWords.includes('뜻밖의 세 단어'))
  assert.doesNotMatch(nativeWords, /‹ 홈/)
  assert.match(native, /tab\("홈", 0\)/)
})
