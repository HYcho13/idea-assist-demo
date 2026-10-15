import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/apple-ui.css', import.meta.url), 'utf8')
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/demo-main.jsx', import.meta.url), 'utf8')

test('Apple presentation keeps mobile zoom, safe area and readable input sizing', () => {
  assert.match(html, /viewport-fit=cover/)
  assert.match(html, /interactive-widget=resizes-content/)
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/)
  assert.match(css, /\.input-row input, \.field input, \.search input \{ font-size: 16px/)
  assert.match(css, /\.app-device \{[^}]*height: 100dvh/)
})

test('Apple feedback has capability gating and accessibility alternatives', () => {
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /prefers-reduced-transparency: reduce/)
  assert.match(css, /prefers-contrast: more/)
  assert.match(css, /--duration-press: 160ms/)
  assert.doesNotMatch(css, /transition:\s*all|user-select:\s*none[^}]*body/)
})

test('UI refactor preserves three tabs and avoids artificial rule-mode waiting', () => {
  for (const label of ['홈 탭', '무작위 아이디어 생성', '보관함 탭']) assert.ok(app.includes(label))
  assert.doesNotMatch(app, /setTimeout\(resolve, 650\)/)
  assert.match(app, /event\.key === 'Escape'/)
  assert.match(app, /event\.key === 'Tab'/)
})

test('model settings has a stable label and new idea caption is centered directly below plus', () => {
  assert.match(app,/모델 설정<Cpu/)
  assert.match(css,/\.bottom-tabs \.plus-tab > span \{[^}]*left: 50%[^}]*top: calc\(100% \+ 8px\)[^}]*translateX\(-50%\)[^}]*text-align: center/)
  const native=readFileSync(new URL('../android/app/src/main/java/com/ideaassist/app/MainActivity.kt',import.meta.url),'utf8')
  assert.match(native,/contentDescription="모델 설정"/)
  assert.match(native,/label\("새 아이디어"[^\n]*Gravity.CENTER[^\n]*TEXT_ALIGNMENT_CENTER/)
})
