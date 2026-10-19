import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { freshLibrary, saveRecord } from '../src/demo/storage.js'
import { composeIdea, elaborateIdea } from '../src/demo/domain.js'
import * as backup from '../src/demo/backup.js'
const { exportTextBackup } = backup

const fixture = () => {
  const idea=composeIdea({categoryId:'food',words:['딸기','자전거','구름'],condition:'작게 시작하기'})
  idea.elaboration=elaborateIdea(idea); idea.elaborationSource='rules'
  idea.description += '\n줄바꿈과 "따옴표", 이모지 🍓'
  const library=saveRecord(freshLibrary(),idea,{name:'나의 딸기 아이디어',folderId:'default'})
  library.customWords=['딸기','여행']; library.draft={apiKey:'mock-private-draft-not-for-export'}
  library.apiKey='mock-private-settings-not-for-export'; library.ideas[0].apiKey='mock-private-record-not-for-export'
  return library
}
test('TXT export is readable Korean with steps and elaboration, without restoration payload or private settings',()=>{
  const data=fixture(), text=exportTextBackup(data)
  for(const value of ['보관함 내보내기','나의 딸기 아이디어','[아이디어 설명]','[작게 시작하는 방법]','[구체화]',data.ideas[0].elaboration.target_user,'줄바꿈과 "따옴표", 이모지 🍓']) assert.ok(text.includes(value))
  assert.ok(text.startsWith('\uFEFF')); assert.ok(text.includes('\r\n'))
  assert.doesNotMatch(text,/mock-private|apiKey|IDEA-ASSIST-BACKUP|복원 데이터|"version":/)
})
test('export does not change saved ideas, draft, folders or custom words',()=>{
  const data=fixture(), before=JSON.stringify(data)
  exportTextBackup(data)
  assert.equal(JSON.stringify(data),before)
})
test('empty archive and multiple folders export as plain text, preserving readable source labels',()=>{
  assert.match(exportTextBackup(freshLibrary()),/저장한 아이디어: 0개/)
  const data=fixture(); data.folders.push({id:'travel',name:'여행 폴더'})
  data.ideas[0].folderId='travel'; data.ideas[0].source='gemini'; data.ideas[0].model='test-model'
  const text=exportTextBackup(data)
  assert.match(text,/폴더: 여행 폴더/); assert.match(text,/Google Gemini 생성 \/ test-model/)
})
test('invalid and oversized libraries reject export instead of reporting success',()=>{
  assert.throws(()=>exportTextBackup({}),/백업/)
  const data=fixture(), idea=data.ideas[0], long='가'.repeat(2000)
  data.ideas=Array.from({length:500},(_,i)=>({...idea,id:'export-limit-'+i,description:long,one_liner:long,steps:[long,long,long]}))
  assert.throws(()=>exportTextBackup(data),/10MB/)
})
test('web/native expose TXT export only, remove import handlers and explanation, and keep unsaved dialog actions',()=>{
  const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
  const app=read('../src/demo-main.jsx'), leave=read('../src/LeaveDialog.jsx')
  const native=read('../android/app/src/main/java/com/ideaassist/app/MainActivity.kt')
  assert.match(app,/link.download = '아이디어-보관함-백업.txt'/)
  assert.doesNotMatch(app,/importLibrary|importTextBackup|mergeBackup|type="file"|import-label|backup-help|가져오기/)
  assert.doesNotMatch(native,/ACTION_OPEN_DOCUMENT|requestCode == 102|LibraryBackup.importText|LibraryBackup.merge|↑ 가져오기|TXT로 읽고|기존 JSON 백업/)
  assert.deepEqual(Object.keys(backup).sort(),['MAX_BACKUP_BYTES','exportTextBackup'])
  assert.match(native,/ACTION_CREATE_DOCUMENT/)
  assert.match(app,/busyRef.current \|\| unsaved/)
  assert.match(app,/<LeaveDialog\s+onSave=/)
  assert.match(leave,/onClick=\{onStay\}>계속 다듬기/)
  assert.match(leave,/onClick=\{onSave\}>저장하러 가기/)
  assert.match(native,/private fun showLeaveDialog/)
})
