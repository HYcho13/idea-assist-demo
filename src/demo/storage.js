export const STORAGE_KEY = 'idea-assist-demo-v1'
export const defaultFolder = { id: 'default', name: '기본 폴더' }
export const freshLibrary = () => ({ version: 1, ideas: [], folders: [{ ...defaultFolder }], customWords: [], draft: null })
export function nextIdeaName(ideas) {
  const numbers = ideas.map(idea => /^새 아이디어 ([1-9]\d*)$/.exec(idea.name || '')).filter(Boolean).map(match => Number(match[1])).filter(value => Number.isSafeInteger(value) && value < Number.MAX_SAFE_INTEGER)
  return `새 아이디어 ${Math.max(0, ...numbers) + 1}`
}
function migrateTestNames(ideas) {
  const migrated = ideas.map(idea => ({ ...idea }))
  // Only exact legacy test labels; never overwrite an ordinary user-supplied name.
  for (const idea of [...migrated].reverse()) if (/^(자동 검증 · 규칙|직접 주제 검증 · 규칙) [0-9a-f]{6}$/.test(idea.name)) idea.name = nextIdeaName(migrated)
  return migrated
}

export function validateLibrary(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.ideas) || !Array.isArray(value.folders) || !Array.isArray(value.customWords)) throw new Error('올바른 아이디어 백업 파일이 아니에요.')
  if (value.ideas.length > 500 || value.folders.length > 30 || value.customWords.length > 10) throw new Error('백업 파일의 항목이 너무 많아요.')
  const short = (v, max = 2000) => typeof v === 'string' && v.length > 0 && v.length <= max
  if (value.folders.some(f => !short(f.id, 100) || !short(f.name, 30))) throw new Error('폴더 정보를 읽을 수 없어요.')
  if (value.customWords.some(w => !short(w, 12)) || new Set(value.customWords).size !== value.customWords.length) throw new Error('단어 정보를 읽을 수 없어요.')
  if (new Set(value.folders.map(f => f.id)).size !== value.folders.length || new Set(value.ideas.map(i => i.id)).size !== value.ideas.length) throw new Error('백업 파일의 항목이 중복돼요.')
  if (value.ideas.some(i => !short(i.id, 100) || !short(i.title) || !short(i.name, 80) || !short(i.description) || !Array.isArray(i.used_words) || i.used_words.length !== 3 || i.used_words.some(w => !short(w, 12)) || !Array.isArray(i.steps) || i.steps.length !== 3 || i.steps.some(s => !short(s)) || !['food', 'program', 'contest', 'custom'].includes(i.categoryId) || (i.categoryId === 'custom' && !short(i.topic,80)) || !value.folders.some(f => f.id === i.folderId))) throw new Error('아이디어 내용을 읽을 수 없어요.')
  if (value.ideas.some(i => !short(i.one_liner) || !Number.isFinite(Date.parse(i.savedAt)) || (i.elaboration && (['target_user', 'problem', 'value', 'first_prototype'].some(k => !short(i.elaboration[k])) || !Array.isArray(i.elaboration.core_features) || i.elaboration.core_features.length !== 3 || i.elaboration.core_features.some(v => !short(v)) || !Array.isArray(i.elaboration.risks) || i.elaboration.risks.some(v => !short(v)))))) throw new Error('구체화 내용을 읽을 수 없어요.')
  return { version: 1, ideas: migrateTestNames(value.ideas), folders: value.folders.length ? value.folders : [{ ...defaultFolder }], customWords: value.customWords, draft: value.draft || null }
}

export function readLibrary(storage = globalThis.localStorage) {
  try {
    const data = storage.getItem(STORAGE_KEY)
    return { library: data ? validateLibrary(JSON.parse(data)) : freshLibrary(), error: '' }
  } catch {
    return { library: freshLibrary(), error: '저장 내용을 읽지 못했어요. 기존 데이터를 덮어쓰지 않고 임시로 시작합니다.' }
  }
}
export function writeLibrary(value, storage = globalThis.localStorage) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(value)) }
  catch { throw new Error('브라우저에 저장할 수 없어요. 결과를 복사하거나 백업해 주세요.') }
}
export function saveRecord(library, idea, { name, folderId }) {
  if (!idea?.id || !idea.title) throw new Error('먼저 아이디어를 만들어 주세요.')
  if (!library.folders.some(f => f.id === folderId)) throw new Error('저장할 폴더를 선택해 주세요.')
  const existing = library.ideas.find(record => record.id === idea.id)
  const record = { ...idea, name: name.trim().slice(0, 80) || existing?.name || nextIdeaName(library.ideas), folderId, savedAt: new Date().toISOString() }
  return { ...library, ideas: [record, ...library.ideas.filter(x => x.id !== idea.id)] }
}
