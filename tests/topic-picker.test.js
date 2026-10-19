import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { categories } from '../src/demo/data.js'
import { validateTopic } from '../src/demo/topic.js'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
const app=read('../src/demo-main.jsx'), picker=read('../src/TopicPicker.jsx')
const native=read('../android/app/src/main/java/com/ideaassist/app/MainActivity.kt')
test('plus opens four topic choices without choosing a random category or generating on open',()=>{
  assert.equal(categories.length+1,4)
  const open=app.slice(app.indexOf('function quickStart(event)'),app.indexOf('function selectTopic'))
  assert.match(open,/setModal\(\{ type: 'topic' \}\)/)
  assert.doesNotMatch(open,/Math.random|start\(|runGeneration|guarded\(/)
  assert.match(picker,/categories.map/); assert.match(picker,/>직접 입력</)
  assert.doesNotMatch(native,/categoryIds.random\(/)
  assert.doesNotMatch(app,/무작위 아이디어 생성|무작위로 바로 만들어요/)
})
test('custom input validates before moving to word selection and cancel never starts work',()=>{
  assert.match(picker,/setPage\('input'\)/)
  assert.match(picker,/onSelect\('custom', validateTopic\(topic\)\)/)
  assert.match(picker,/disabled=\{!topic.trim\(\)\}/)
  assert.match(picker,/maxLength=\{80\}/)
  assert.match(picker,/isComposing/)
  assert.match(picker,/onClick=\{onCancel\}>취소/)
  assert.match(app,/guarded\(\(\) => start\(id, value\)\)/)
  assert.match(picker,/>단어 조합으로 이동</)
  assert.equal(validateTopic('  반려동물  여행  '),'반려동물 여행')
  assert.throws(()=>validateTopic('   ')); assert.throws(()=>validateTopic('가'.repeat(81)))
  assert.match(native,/SOFT_INPUT_ADJUST_RESIZE/)
})
test('all topic choices only prepare editable words; generation requires the word-screen action',()=>{
  const start=app.slice(app.indexOf('function start(id,'),app.indexOf('function quickStart(event)'))
  assert.match(start,/navigate\('words'\)/)
  assert.match(start,/setIdea\(null\)/)
  assert.doesNotMatch(start,/runGeneration|quick|fresh/)
  const nativeStart=native.slice(native.indexOf('private fun start('),native.indexOf('private fun showTopicPicker()'))
  assert.match(nativeStart,/session.screen = "words"/)
  assert.doesNotMatch(nativeStart,/generate\(|quick/)
  assert.match(app,/onClick=\{\(\) => runGeneration\('generate'\)\}/)
  assert.doesNotMatch(picker,/onGenerate|바로 생성|이 주제로 생성하기/)
  assert.doesNotMatch(native,/start\(id,true|이 주제로 생성하기|바로 생성해요/)
  assert.match(app,/setScreen\(type === 'generate' && !current \? 'words'/)
})
