import { validateLibrary } from './storage.js'
import { sourceLabel } from './ai-contract.js'

export const MAX_BACKUP_BYTES = 10_000_000
const ideaKeys = ['id','title','name','one_liner','description','steps','used_words','word_links','categoryId','category','topic','condition','source','model','revision','direction','what_changed','folderId','savedAt','elaboration','elaborationSource','elaborationModel']
const detailKeys = ['target_user','problem','value','core_features','first_prototype','risks']
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))
const bytes = text => new TextEncoder().encode(text).length

// Export only library data, never model settings, keys or an in-progress draft.
function snapshot(library) {
  const checked = validateLibrary(library)
  return { version: 1, ideas: checked.ideas.map(idea => {
    const clean = pick(idea, ideaKeys)
    if (clean.word_links) clean.word_links = pick(clean.word_links, ['material','method','mood'])
    if (clean.elaboration) clean.elaboration = pick(clean.elaboration, detailKeys)
    return clean
  }), folders: checked.folders.map(f => pick(f, ['id','name'])), customWords: checked.customWords, draft: null }
}

export function exportTextBackup(library) {
  const data = snapshot(library)
  const lines = ['아이디어 보조 · 보관함 내보내기',
    `저장한 아이디어: ${data.ideas.length}개`, `폴더: ${data.folders.map(f => f.name).join(' · ')}`,
    `내 단어: ${data.customWords.join(' · ') || '없음'}`, '']
  data.ideas.forEach((idea, index) => {
    lines.push('='.repeat(40), `${index + 1}. ${idea.name}`, `원래 제목: ${idea.title}`,
      `분야: ${idea.category || idea.categoryId}${idea.topic ? ` / ${idea.topic}` : ''}`,
      `폴더: ${data.folders.find(f => f.id === idea.folderId).name}`, `저장일: ${idea.savedAt}`,
      `생성 방식: ${sourceLabel(idea.source)}${idea.model ? ` / ${idea.model}` : ''}`,
      `단어: ${idea.used_words.join(' · ')}`, `조합 조건: ${idea.condition || '없음'}`,
      '', '[한 줄 소개]', idea.one_liner, '', '[아이디어 설명]', idea.description, '', '[작게 시작하는 방법]',
      ...idea.steps.map((step, i) => `${i + 1}. ${step}`))
    if (idea.word_links) lines.push('', '[세 단어의 연결]', ...['material','method','mood'].map((key, i) => `${idea.used_words[i]}: ${idea.word_links[key] || ''}`))
    if (idea.what_changed) lines.push('', '[다듬은 내용]', idea.what_changed)
    if (idea.elaboration) {
      const d = idea.elaboration
      lines.push('', '[구체화]', `대상 사용자: ${d.target_user}`, `해결할 불편: ${d.problem}`, `핵심 가치: ${d.value}`,
        '핵심 기능:', ...d.core_features.map((s,i) => `${i+1}. ${s}`), `첫 프로토타입: ${d.first_prototype}`,
        '먼저 확인할 위험:', ...d.risks.map((s,i) => `${i+1}. ${s}`), `구체화 생성 방식: ${sourceLabel(idea.elaborationSource)}${idea.elaborationModel ? ` / ${idea.elaborationModel}` : ''}`)
    }
    lines.push('')
  })
  const text = '\uFEFF' + lines.join('\r\n')
  if (bytes(text) > MAX_BACKUP_BYTES) throw new Error('백업은 10MB 이하여야 해요. 보관함 크기를 확인해 주세요.')
  return text
}
