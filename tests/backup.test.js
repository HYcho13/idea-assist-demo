import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { freshLibrary, saveRecord } from '../src/demo/storage.js'
import { composeIdea, elaborateIdea } from '../src/demo/domain.js'
import { BACKUP_START, BACKUP_END, MAX_BACKUP_BYTES, exportTextBackup, importTextBackup, mergeBackup } from '../src/demo/backup.js'

const fixture = () => {
  const idea=composeIdea({categoryId:'food',words:['딸기','자전거','구름'],condition:'작게 시작하기'})
  idea.elaboration=elaborateIdea(idea); idea.elaborationSource='rules'
  idea.description += '\n줄바꿈과 "따옴표", 이모지 🍓\n' + BACKUP_START
  const library=saveRecord(freshLibrary(),idea,{name:'나의 딸기 아이디어',folderId:'default'})
  library.customWords=['딸기','여행']; library.draft={apiKey:'mock-private-draft-not-for-export'}
  library.apiKey='mock-private-settings-not-for-export'; library.ideas[0].apiKey='mock-private-record-not-for-export'
  return library
}
test('TXT contains readable Korean content, steps and elaboration, and restores losslessly without keys/draft',()=>{
  const data=fixture(), text=exportTextBackup(data), restored=importTextBackup(text)
  for(const value of ['아이디어 보조 · 보관함 백업','나의 딸기 아이디어','[아이디어 설명]','[작게 시작하는 방법]','[구체화]',data.ideas[0].elaboration.target_user]) assert.ok(text.includes(value))
  assert.ok(text.startsWith('\uFEFF')); assert.ok(text.includes('\r\n'))
  assert.doesNotMatch(text,/mock-private|apiKey/)
  const {apiKey,...clean}=data.ideas[0]
  assert.deepEqual(restored.ideas[0],clean); assert.equal(restored.draft,null)
  assert.deepEqual(restored.customWords,data.customWords); assert.deepEqual(restored.folders,data.folders)
  assert.deepEqual(importTextBackup(text.replace(/\r\n/g,'\n')),restored)
  assert.deepEqual(importTextBackup(text.replace('나의 딸기 아이디어','읽기용 본문만 수정')),restored)
})
test('old JSON backups remain importable; empty TXT works; merge preserves existing records and draft',()=>{
  const data=fixture()
  const incoming=importTextBackup(JSON.stringify(data))
  const current={...incoming,draft:{words:['a','b','c']}}
  current.ideas[0]={...current.ideas[0],name:'기존 제목 유지'}
  const merged=mergeBackup(current,incoming)
  assert.equal(merged.ideas.length,1); assert.equal(merged.ideas[0].name,'기존 제목 유지')
  assert.deepEqual(merged.draft,current.draft)
  assert.deepEqual(importTextBackup(exportTextBackup(freshLibrary())),freshLibrary())
})
test('ordinary text, corrupt/missing recovery data, malformed legacy JSON and oversized input fail before merging',()=>{
  const text=exportTextBackup(fixture())
  for(const bad of ['메모장에 직접 쓴 일반 텍스트',text.replace(BACKUP_END,''),text+'뒤에 다른 내용',text.replace('"version": 1','"version": 99'),'{broken','{"nested":'+ '['.repeat(40)+'0'+']'.repeat(40)+'}',' '.repeat(MAX_BACKUP_BYTES+1)]) assert.throws(()=>importTextBackup(bad),/백업|TXT/)
})
test('web/native share a readable TXT fixture with custom topic, folders and elaboration',()=>{
  const text=readFileSync(new URL('../android/app/src/debug/assets/web-txt-backup-fixture.txt',import.meta.url),'utf8')
  const data=importTextBackup(text)
  assert.equal(data.ideas[0].name,'교차 복원 검사')
  assert.equal(data.ideas[0].topic,'반려동물과 여행')
  assert.equal(data.ideas[0].elaboration.core_features.length,3)
  assert.equal(data.folders[1].name,'여행 폴더')
  assert.deepEqual(importTextBackup(exportTextBackup(data)),data)
})
test('backup UI uses TXT; unsaved popup matches grouped design and keeps cancel/save/leave separate',()=>{
  const app=readFileSync(new URL('../src/demo-main.jsx',import.meta.url),'utf8')
  const leave=readFileSync(new URL('../src/LeaveDialog.jsx',import.meta.url),'utf8')
  const native=readFileSync(new URL('../android/app/src/main/java/com/ideaassist/app/MainActivity.kt',import.meta.url),'utf8')
  assert.match(app,/link.download = '아이디어-보관함-백업.txt'/)
  assert.match(app,/accept="text\/plain,.txt,application\/json,.json"/)
  assert.match(app,/busyRef.current \|\| unsaved/)
  assert.match(app,/<LeaveDialog\s+onSave=/)
  assert.match(leave,/leave-icon/); assert.match(leave,/onClick=\{onStay\}>계속 다듬기/)
  assert.match(leave,/onClick=\{onSave\}>저장하러 가기/)
  assert.match(native,/private fun showLeaveDialog/)
  assert.doesNotMatch(native,/AlertDialog.Builder\(this\).setTitle\("저장하지/)
})
