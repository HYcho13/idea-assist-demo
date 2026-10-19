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
  const open=app.slice(app.indexOf('function quickStart(event)'),app.indexOf('function generateFromTopic'))
  assert.match(open,/setModal\(\{ type: 'topic' \}\)/)
  assert.doesNotMatch(open,/Math.random|start\(|runGeneration|guarded\(/)
  assert.match(picker,/categories.map/); assert.match(picker,/>직접 입력</)
  assert.doesNotMatch(native,/categoryIds.random\(/)
  assert.doesNotMatch(app,/무작위 아이디어 생성|무작위로 바로 만들어요/)
})
test('custom input stays in popup, validates before generating and cancel never starts work',()=>{
  assert.match(picker,/setPage\('input'\)/)
  assert.match(picker,/onGenerate\('custom', validateTopic\(topic\)\)/)
  assert.match(picker,/disabled=\{!topic.trim\(\)\}/)
  assert.match(picker,/maxLength=\{80\}/)
  assert.match(picker,/isComposing/)
  assert.match(picker,/onClick=\{onCancel\}>취소/)
  assert.match(app,/guarded\(\(\) => start\(id, true, value\)\)/)
  assert.equal(validateTopic('  반려동물  여행  '),'반려동물 여행')
  assert.throws(()=>validateTopic('   ')); assert.throws(()=>validateTopic('가'.repeat(81)))
  assert.match(native,/SOFT_INPUT_ADJUST_RESIZE/)
})
test('new topic generation cancels or fails back to its selected words, not an emptied old result',()=>{
  assert.match(app,/variant: 0, fresh: true/)
  assert.match(app,/const current = overrides.fresh \? null : idea/)
  assert.match(app,/const from = overrides.fresh \? 'words' : screen/)
})
