import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Cpu, Download, Folder, Home, Lightbulb, LoaderCircle, LockKeyhole, Plus, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react'
import { categories, roles, directions } from './demo/data.js'
import { uid, normalize, drawWords, composeIdea, developIdea, elaborateIdea, suggestNames } from './demo/domain.js'
import { readLibrary, writeLibrary, saveRecord, nextIdeaName } from './demo/storage.js'
import { checkGPU, loadModel, stopModel, modelGenerate, MODEL_ID } from './demo/ai.js'
import { cloudGenerate, CLOUD_MODEL } from './demo/cloud-ai.js'
import { geminiGenerate, GEMINI_MODEL } from './demo/gemini-ai.js'
import { validateTopic } from './demo/topic.js'
import EngineSettings from './EngineSettings.jsx'
import TopicPicker from './TopicPicker.jsx'
import LeaveDialog from './LeaveDialog.jsx'
import ConditionField from './ConditionField.jsx'
import GenerationProgress from './GenerationProgress.jsx'
import { conditionError, restoreCondition, validateCondition } from './demo/condition.js'
import { exportTextBackup } from './demo/backup.js'
import { readConsent, readCloudProvider } from './demo/cloud-settings.js'
import { sourceForMode, sourceLabel } from './demo/ai-contract.js'
import './demo.css'
import './apple-ui.css'

const meta = { home: ['홈', '발상의 시작'], words: ['단어 조합', '세 단어의 연결'], custom: ['내 단어', '나만의 소재'], loading: ['생성 중', '새로운 가능성'], result: ['아이디어', '하나의 새로운 조합'], elaborate: ['구체화', '첫 실험까지 한 걸음'], save: ['저장', '생각을 담아두기'], saved: ['저장 완료', '다음에도 이어서'], archive: ['보관함', '모아둔 생각들'] }
const initial = readLibrary()
const draft = initial.library.draft

function App() {
  const [library, setLibrary] = useState(initial.library)
  const [storageProblem, setStorageProblem] = useState(initial.error)
  const [screen, setScreen] = useState('home')
  const [categoryId, setCategoryId] = useState(draft?.categoryId === 'custom' || categories.some(c => c.id === draft?.categoryId) ? draft.categoryId : '')
  const [topic, setTopic] = useState(typeof draft?.topic === 'string' ? draft.topic.slice(0,80) : '')
  const [topicInput, setTopicInput] = useState(typeof draft?.topic === 'string' ? draft.topic.slice(0,80) : '')
  const [words, setWords] = useState(Array.isArray(draft?.words) && draft.words.length === 3 && draft.words.every(w => typeof w === 'string') ? draft.words : [])
  const [condition, setCondition] = useState(restoreCondition(draft?.condition))
  const [locked, setLocked] = useState([])
  const [idea, setIdea] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState('home')
  const [customInput, setCustomInput] = useState('')
  const [selectedCustom, setSelectedCustom] = useState([])
  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState('default')
  const [folderName, setFolderName] = useState('')
  const [nameOptions, setNameOptions] = useState([])
  const [search, setSearch] = useState('')
  const [filterFolder, setFilterFolder] = useState('all')
  const [modal, setModal] = useState(null)
  const [mode, setMode] = useState('local')
  // Session memory only: never put the key in library, draft, storage or exports.
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState(() => readCloudProvider())
  const [modelState, setModelState] = useState('idle')
  const [modelProgress, setModelProgress] = useState({ progress: 0, text: '' })
  const [gpu, setGPU] = useState(null)
  const [variant, setVariant] = useState(0)
  const [prior, setPrior] = useState(null)
  const [selectedDirection, setSelectedDirection] = useState(null)
  const [retryTask, setRetryTask] = useState(null)
  const bodyRef = useRef(null), toastTimer = useRef(null), operation = useRef(0), busyRef = useRef(false), generationOrigin = useRef('home')
  const generationController = useRef(null), preparation = useRef(0)
  const topicTrigger = useRef(null)
  const category = categoryId === 'custom' ? { name: topic } : categories.find(c => c.id === categoryId)
  function changeProvider(value) { setProvider(value); setApiKey(''); if (mode === 'cloud') setMode('local') }
  const stored = idea && library.ideas.find(i => i.id === idea.id && i.revision === idea.revision)
  const unsaved = Boolean(idea && !stored)
  useEffect(() => { setSelectedDirection(null) }, [idea?.id, idea?.revision, screen])

  useEffect(() => { checkGPU().then(setGPU); return () => { clearTimeout(toastTimer.current); operation.current++; preparation.current++; generationController.current?.abort(); stopModel() } }, [])
  useEffect(() => {
    const sync = event => {
      if (event.key !== 'idea-assist-demo-v1') return
      const updated = readLibrary()
      if (!updated.error) setLibrary(updated.library)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [screen])
  // Native-like modal behavior: keep keyboard focus inside, then return to the trigger.
  useEffect(() => {
    if (!modal) return
    const trigger = modal.type === 'topic' ? topicTrigger.current : document.activeElement
    const dialog = document.querySelector('[role="dialog"]')
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(node => node.getClientRects().length)
    focusable()[0]?.focus()
    const handleKey = event => {
      if (event.key === 'Escape' && !dialog.querySelector('.close-modal')?.disabled) {
        event.preventDefault(); setModal(null)
      } else if (event.key === 'Tab') {
        const nodes = focusable(), first = nodes[0], last = nodes.at(-1)
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); if (trigger?.isConnected) trigger.focus() }
  }, [modal])
  useEffect(() => {
    // Browsers control the appearance/text of the tab-close warning.
    const onClose = e => { if (busyRef.current || unsaved) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', onClose)
    return () => window.removeEventListener('beforeunload', onClose)
  }, [unsaved])

  function notify(text) { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(''), 3000) }
  function persist(next) {
    if (storageProblem) { setError('브라우저 저장소를 사용할 수 없어요. 결과 복사 또는 백업으로 보관해 주세요.'); return false }
    try { writeLibrary(next); setLibrary(next); return true }
    catch (e) { setError(e.message); return false }
  }
  function keepDraft(nextWords = words, nextCategory = categoryId, nextCondition = condition, nextTopic = topic) {
    const next = { ...library, draft: { words: nextWords, categoryId: nextCategory, condition: nextCondition, topic: nextTopic } }
    if (!storageProblem) { try { writeLibrary(next); setLibrary(next) } catch (e) { setStorageProblem(e.message) } }
  }
  function navigate(next) { setScreen(next); setError('') }
  function guarded(action) {
    if (busyRef.current) { notify('완료하거나 취소한 뒤 이동할 수 있어요.'); return }
    if (unsaved) setModal({ type: 'leave', action: () => { setIdea(null); action() } })
    else action()
  }
  function start(id, inputTopic = '') {
    generationOrigin.current = 'home'
    const combo = drawWords(id)
    setCategoryId(id); setTopic(inputTopic); setWords(combo.words); setCondition(''); setLocked([])
    setIdea(null); setPrior(null); setNameOptions([]); setVariant(0); setTab('home')
    keepDraft(combo.words, id, '', inputTopic)
    navigate('words')
  }
  function quickStart(event) {
    if (busyRef.current) return notify('완료하거나 취소한 뒤 주제를 선택할 수 있어요.')
    topicTrigger.current = event?.currentTarget || document.activeElement
    setModal({ type: 'topic' })
  }
  function selectTopic(id, value) {
    setModal(null)
    guarded(() => start(id, value))
  }
  function startTopic(event) {
    event.preventDefault()
    try { const value = validateTopic(topicInput); guarded(() => start('custom', value)) } catch(e) { setError(e.message) }
  }
  function reroll() {
    const combo = drawWords(categoryId, { current: words, locked })
    setWords(combo.words); setIdea(null); setPrior(null); setVariant(0)
    keepDraft(combo.words, categoryId, condition)
    notify('고정한 위치는 유지하고 나머지만 바꿨어요.')
  }
  function toggleLock(index) {
    if (locked.includes(index)) setLocked(locked.filter(i => i !== index))
    else if (locked.length < 2) setLocked([...locked, index])
    else notify('최대 2개까지 고정할 수 있어요.')
  }
  async function runGeneration(type, overrides = {}) {
    if (busyRef.current) return
    let requestCondition
    try { requestCondition = validateCondition(overrides.condition ?? (type === 'generate' ? condition : idea?.condition ?? condition)) }
    catch (failure) { setError(failure.message); return }
    const token = ++operation.current
    const args = { categoryId: overrides.id || categoryId, topic: overrides.topic ?? topic, words: overrides.words || words, condition: requestCondition, variant: overrides.variant ?? variant, direction: overrides.direction }
    const current = idea
    const requestMode = mode
    const controller = new AbortController()
    generationController.current = controller
    const from = screen
    generationOrigin.current = from
    setRetryTask({ type, overrides }); setError(''); setBusy(true); busyRef.current = true; navigate('loading')
    try {
      let value
      if (requestMode === 'ai' || requestMode === 'cloud') {
        if (requestMode === 'cloud' && !readConsent(provider)) throw new Error('개인 API 키 설정에서 전송·API 비용 동의를 확인하고 설정을 저장해 주세요.')
        const request = { ...args, category: args.categoryId === 'custom' ? args.topic : categories.find(c => c.id === args.categoryId).name, current: type === 'generate' ? undefined : current, previous: type === 'generate' ? current : undefined, type, directionId: args.direction, direction: directions.find(d => d.id === args.direction)?.label }
        value = requestMode === 'cloud' ? await (provider === 'gemini' ? geminiGenerate : cloudGenerate)(request, { apiKey, signal: controller.signal }) : await modelGenerate(request, { signal: controller.signal })
      } else {
        // Rule mode is synchronous; don't fake model latency for presentation.
        value = type === 'generate' ? composeIdea(args) : type === 'develop' ? developIdea(current, args.direction) : elaborateIdea(current)
        if (type === 'develop') value = { ...value, model: undefined, word_links: undefined, elaborationSource: undefined, elaborationModel: undefined }
      }
      if (token !== operation.current) return
      if (type === 'elaborate') { setIdea({ ...current, elaboration: value, elaborationSource: sourceForMode(requestMode,provider), elaborationModel: requestMode === 'cloud' ? (provider === 'gemini' ? GEMINI_MODEL : CLOUD_MODEL) : requestMode === 'ai' ? MODEL_ID : undefined, revision: (current.revision || 1) + 1 }); navigate('elaborate') }
      else { if (type === 'develop') setPrior(current); else setPrior(null); setIdea(value); navigate('result') }
    } catch (e) {
      if (token === operation.current) { setScreen(type === 'generate' && !current ? 'words' : from === 'home' ? 'words' : from); setError(e.message || '결과를 만들지 못했어요. 다시 시도해 주세요.') }
    } finally { if (token === operation.current) { generationController.current = null; setBusy(false); busyRef.current = false } }
  }
  function cancelGeneration() {
    operation.current++; busyRef.current = false; setBusy(false)
    generationController.current?.abort(); generationController.current = null
    if (mode === 'ai') { stopModel(); setModelState('idle'); notify('온디바이스 AI 작업을 취소했어요. 다시 쓰려면 모델을 준비해 주세요.') }
    else if (mode === 'cloud') notify('클라우드 요청을 취소했어요. 이미 처리된 요청에는 비용이 발생할 수 있어요.')
    navigate(idea ? 'result' : 'words')
  }
  function addCustom() {
    const value = normalize(customInput)
    if (!value || value.length > 12) return setError('1~12자 단어를 입력해 주세요.')
    if (library.customWords.some(w => w.toLocaleLowerCase() === value.toLocaleLowerCase())) return setError('이미 추가한 단어예요.')
    if (library.customWords.length >= 10) return setError('내 단어는 최대 10개까지 보관해요.')
    if (persist({ ...library, customWords: [...library.customWords, value] })) { setCustomInput(''); setError(''); if (selectedCustom.length < 2) setSelectedCustom([...selectedCustom, value]) }
  }
  function applyCustom() {
    if (!selectedCustom.length) return setError('적용할 단어를 선택해 주세요.')
    const combo = drawWords(categoryId, { custom: selectedCustom, current: words })
    setWords(combo.words); setLocked(selectedCustom.map((_, i) => i)); setIdea(null); keepDraft(combo.words, categoryId, condition); navigate('words')
  }
  function openSave() { setName(idea.name || library.ideas.find(record => record.id === idea.id)?.name || nextIdeaName(library.ideas)); setNameOptions([]); setFolderId(idea.folderId || 'default'); navigate('save') }
  function save() {
    const next = saveRecord(library, idea, { name, folderId })
    if (persist(next)) { setIdea(next.ideas[0]); setTab('archive'); navigate('saved'); notify('이 브라우저에 저장했어요.') }
  }
  function newFolder() {
    const value = normalize(folderName)
    if (!value || value.length > 30) return setError('폴더 이름은 1~30자로 입력해 주세요.')
    if (library.folders.some(f => f.name === value)) return setError('같은 이름의 폴더가 있어요.')
    if (library.folders.length >= 30) return setError('폴더는 최대 30개까지 만들 수 있어요.')
    const folder = { id: uid(), name: value }
    if (persist({ ...library, folders: [...library.folders, folder] })) { setFolderId(folder.id); setFolderName(''); setError('') }
  }
  function openRecord(record) { setIdea(record); setCategoryId(record.categoryId); setTopic(record.topic || ''); setTopicInput(record.topic || ''); setWords(record.used_words); setCondition(record.condition || ''); setLocked([]); setPrior(null); setTab('archive'); navigate('result') }
  function exportLibrary() {
    try {
    const snapshot = idea && !library.ideas.some(x => x.id === idea.id) ? saveRecord(library, idea, { name: idea.name || nextIdeaName(library.ideas), folderId: library.folders[0].id }) : library
    const blob = new Blob([exportTextBackup(snapshot)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = '아이디어-보관함-백업.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setError(e.message || '백업 파일을 만들지 못했어요.') }
  }
  async function copyResult() {
    try {
      await navigator.clipboard.writeText(`${idea.name || idea.title}\n${idea.one_liner}\n단어: ${idea.used_words.join(' · ')}\n조건: ${idea.condition || '입력 안 함'}\n\n${idea.description}\n\n${idea.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}${idea.elaboration ? `\n\n구체화\n${JSON.stringify(idea.elaboration, null, 2)}` : ''}`)
      notify('아이디어를 복사했어요.')
    } catch { setError('클립보드에 접근하지 못했어요. 보관함 백업을 이용해 주세요.') }
  }
  async function initAI() {
    if (modelState === 'loading') return
    const token = ++preparation.current
    setMode('ai')
    setModelState('loading'); setModelProgress({ progress: 0, text: '브라우저 GPU를 확인하고 있어요.' }); setError('')
    try { await loadModel(progress => { if (token === preparation.current) setModelProgress(progress) }); if (token !== preparation.current) return; setModelState('ready'); notify('온디바이스 AI 모델이 준비됐어요.') }
    catch (e) { if (token !== preparation.current) return; setModelState('error'); setModelProgress({ progress: 0, text: e.message }) }
  }
  const displayed = library.ideas.filter(i => (filterFolder === 'all' || i.folderId === filterFolder) && `${i.name} ${i.description} ${i.used_words.join(' ')}`.toLowerCase().includes(search.toLowerCase()))

  return <div className="demo-layout">
    <header className="desktop-header"><div className="brand"><div className="brand-icon"><Sparkles size={22} /></div><span>아이디어 보조<small>IDEA ASSIST</small></span></div><span className="desktop-tag">세 단어, 새로운 가능성.</span></header>
    <aside className="intro-panel"><span className="eyebrow">YOUR NEXT LITTLE SPARK</span><h1>익숙한 단어에서<br /><em>새로운 생각으로.</em></h1><p>뜻밖의 세 단어를 연결하고,<br />마음에 드는 아이디어를 한 걸음 발전시켜요.</p><div className="journey"><div><span>01</span><b>조합하기</b><small>분야와 세 단어를 골라요</small></div><div><span>02</span><b>발전시키기</b><small>다른 방향으로 다듬어 봐요</small></div><div><span>03</span><b>담아두기</b><small>다음에 이어갈 생각을 보관해요</small></div></div><div className="local-note"><Lightbulb size={18} /><span>이 기기에 저장돼요.<br />보관함에서 백업도 할 수 있어요.</span></div></aside>
    <main className="app-device" aria-label="아이디어 보조 앱">
      <div className="app-head"><span>{meta[screen][0]}</span><button className={`mode-pill ${mode !== 'local' ? 'ai-on' : ''}`} title={`현재 방식: ${mode === 'cloud' ? '클라우드 AI' : mode === 'ai' ? '온디바이스 AI' : '규칙 시연'}`} onClick={() => { if (busy) return notify('작업을 완료한 뒤 설정할 수 있어요.'); setModal({ type: 'engine' }) }}>모델 설정<Cpu size={14} /></button></div>
      <div ref={bodyRef} className="app-body">
        {screen === 'home' && <section className="home-page">
          <h2 className="headline-41">어떤 아이디어를<br />만들어 볼까요<span className="green-dot">?</span></h2>
          <p className="muted">주제·분야를 직접 적거나 아래에서 골라보세요.</p>
          <form className="topic-start" onSubmit={startTopic}>
            <label className="field">나만의 주제·분야<input value={topicInput} maxLength={80} placeholder="예: 반려동물과 함께하는 여행" onChange={e => setTopicInput(e.target.value)} aria-describedby="topic-help" /></label>
            <p id="topic-help" className="hint">공통 단어 3개를 뽑고, 입력한 주제 안에서 연결해요. 단어도 바꿀 수 있어요.</p>
            <button className="primary" type="submit" disabled={!topicInput.trim()}>입력한 주제로 시작하기<ArrowRight size={18} /></button>
          </form>
          <div className="section-label">또는 추천 분야 선택</div>
          <div className="categories">{categories.map(c => <button key={c.id} className={`category ${categoryId === c.id ? 'selected' : ''}`} onClick={() => setCategoryId(c.id)} aria-pressed={categoryId === c.id}><span className={`category-emoji ${c.accent}`}>{c.icon}</span><span><b>{c.name}</b><small>{c.description}</small></span>{categoryId === c.id ? <Check size={19} /> : <ChevronRight size={19} />}</button>)}</div>
          <button className="primary" disabled={!categories.some(c => c.id === categoryId)} onClick={() => guarded(() => start(categoryId))}>선택하고 시작하기<ArrowRight size={18} /></button>
          <p className="hint"><Plus size={13} /> 아래 + 를 눌러 주제를 고르고 단어를 조합해요.</p>{words.length === 3 && <button className="text-button resume" onClick={() => navigate('words')}>이전에 고른 단어 이어보기 <ArrowRight size={14} /></button>}
        </section>}
        {screen === 'words' && <section><div className="eyebrow">{category?.name}</div><h2 className="headline-41">뜻밖의 세 단어를<br />조합해 보세요.</h2><p className="muted">마음에 드는 단어는 최대 2개까지 고정해요.</p><div className="word-grid">{words.map((w, i) => <button key={`${i}-${w}`} className={`word ${locked.includes(i) ? 'locked' : ''}`} aria-pressed={locked.includes(i)} aria-label={`${roles[i]} ${w} ${locked.includes(i) ? '고정 해제' : '고정'}`} onClick={() => toggleLock(i)}><small>{roles[i]}</small><b>{w}</b><span>{locked.includes(i) ? <><LockKeyhole size={12} /> 고정됨</> : '터치해서 고정'}</span></button>)}</div><ConditionField value={condition} onChange={value => { setCondition(value); setError(''); if (!conditionError(value)) keepDraft(words, categoryId, value) }} /><button className="secondary" onClick={reroll}><RefreshCw size={17} />다시 뽑기</button><button className="text-button" onClick={() => { setSelectedCustom([]); navigate('custom') }}><Plus size={15} />내 단어 추가하기</button><div className="section-space" /><button className="primary" disabled={Boolean(conditionError(condition))} onClick={() => runGeneration('generate')}><Sparkles size={18} />이 조합으로 창조하기</button><ModeCaption mode={mode} /></section>}
        {screen === 'custom' && <section><Back onClick={() => navigate('words')}>단어 조합</Back><h2>내 단어를<br />더해 보세요.</h2><p className="muted">1~2개를 고르면 나머지는 무작위로 채워요.</p><form className="input-row" onSubmit={e => { e.preventDefault(); addCustom() }}><input aria-label="추가할 단어" placeholder="예: 커피" maxLength={12} value={customInput} onChange={e => setCustomInput(e.target.value)} /><button className="small-action" type="submit"><Plus size={17} />추가</button></form><div className="section-label">내 단어 {library.customWords.length}/10 <span>{selectedCustom.length}/2 선택</span></div><div className="custom-list">{library.customWords.length ? library.customWords.map(w => <div className="custom-row" key={w}><button aria-pressed={selectedCustom.includes(w)} onClick={() => { if (selectedCustom.includes(w)) setSelectedCustom(selectedCustom.filter(x => x !== w)); else if (selectedCustom.length < 2) setSelectedCustom([...selectedCustom, w]); else notify('최대 2개까지 선택할 수 있어요.') }}><span className={`check-box ${selectedCustom.includes(w) ? 'checked' : ''}`}>{selectedCustom.includes(w) && <Check size={13} />}</span>{w}</button><button className="icon-button" aria-label={`${w} 내 단어 삭제`} onClick={() => { if (persist({ ...library, customWords: library.customWords.filter(x => x !== w) })) setSelectedCustom(selectedCustom.filter(x => x !== w)) }}><X size={16} /></button></div>) : <Empty title="아직 추가한 단어가 없어요" text="분야와 관련된 단어를 하나 적어보세요." />}</div><div className="section-space" /><button className="primary" disabled={!selectedCustom.length} onClick={applyCustom}>선택한 단어 적용하기<Check size={17} /></button></section>}
        {screen === 'loading' && <section className="loading-page"><span className="eyebrow">{mode === 'cloud' ? 'CLOUD AI' : mode === 'ai' ? 'ONDEVICE AI' : 'RULES DEMO'}</span><h2>{retryTask?.type === 'develop' ? '아이디어를 다듬는 중' : retryTask?.type === 'elaborate' ? '한 걸음 더 구체화하는 중' : '새로운 연결을 찾는 중'}</h2><WordTags words={words} /><div className="spark-loader"><Sparkles size={34} /><span /></div><GenerationProgress mode={mode} provider={provider} /><button className="text-button" onClick={cancelGeneration}>취소하고 돌아가기</button></section>}
        {screen === 'result' && idea && <section><SourceLabel idea={idea} /><h2 className="idea-title">{idea.name || idea.title}</h2><p className="lead">{idea.one_liner}</p><WordTags words={idea.used_words} /><ConditionSummary value={idea.condition} /><article className="content-card"><span className="section-label">아이디어 설명</span><p className="description">{idea.description}</p><span className="section-label">작게 시작하는 방법</span><ol className="steps">{idea.steps.map((s, i) => <li key={i}><span>{i + 1}</span><p>{s}</p></li>)}</ol></article>{idea.what_changed && <div className="change-note"><Sparkles size={15} />{idea.what_changed}</div>}{prior && <button className="text-button" onClick={() => { setIdea(prior); setPrior(null); notify('발전 전 결과로 돌아왔어요.') }}><RefreshCw size={14} />이전 버전으로 되돌리기</button>}<div className="section-label develop-title">어떤 방향으로 다듬을까요?</div><div className="direction-grid">{directions.map(d => <button className={selectedDirection === d.id ? 'chosen' : ''} aria-pressed={selectedDirection === d.id} key={d.id} onClick={() => setSelectedDirection(d.id)}><b>{d.label}</b><small>{d.caption}</small></button>)}</div>{selectedDirection && <button className="primary develop-confirm" onClick={() => runGeneration('develop', { direction: selectedDirection })}><Sparkles size={18} />이 방식으로 다듬기</button>}<div className="actions"><button className="primary" onClick={openSave}><Folder size={17} />{stored ? '이름·폴더 수정하기' : '이 아이디어 저장하기'}</button><button className="secondary" onClick={() => idea.elaboration ? navigate('elaborate') : runGeneration('elaborate')}><Lightbulb size={17} />{idea.elaboration ? '구체화 내용 보기' : '한 걸음 더 구체화하기'}</button><button className="text-button" onClick={() => { const next = variant + 1; setVariant(next); guarded(() => runGeneration('generate', { variant: next })) }}><RefreshCw size={15} />같은 단어로 다시 만들기</button></div></section>}
        {screen === 'elaborate' && idea?.elaboration && <section><Back onClick={() => navigate('result')}>결과</Back><SourceLabel idea={{ source: idea.elaborationSource, model: idea.elaborationModel }} /><h2>아이디어를<br />한 걸음 더.</h2><p className="lead">{idea.title}</p><WordTags words={idea.used_words} /><ConditionSummary value={idea.condition} />{[['누구를 위한 아이디어인가', idea.elaboration.target_user], ['어떤 불편을 해결하나', idea.elaboration.problem], ['이 조합의 가치', idea.elaboration.value]].map(([label, text]) => <Detail key={label} label={label}>{text}</Detail>)}<Detail label="핵심 기능 3개"><ul>{idea.elaboration.core_features.map((t, i) => <li key={i}>{t}</li>)}</ul></Detail><Detail label="첫 프로토타입">{idea.elaboration.first_prototype}</Detail><Detail label="먼저 확인할 위험"><ul>{idea.elaboration.risks.map((t, i) => <li key={i}>{t}</li>)}</ul></Detail><p className="hint">아이디어 초안이에요. 실제 필요성과 실행 조건은 직접 확인해 주세요.</p><button className="primary" onClick={openSave}><Folder size={17} />구체화한 아이디어 저장하기</button></section>}
        {screen === 'save' && idea && <section><Back onClick={() => navigate('result')}>결과</Back><h2>생각을<br />담아두세요.</h2><p className="muted">이름과 폴더를 고르면 이 브라우저에 저장돼요.</p><label className="field">아이디어 이름<input value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="아이디어 이름" /></label><span className="section-label">이름 조합 제안 <span>간편 규칙 방식</span></span><div className="tone-options">{[['base', '담백하게'], ['cute', '귀엽게'], ['hip', '힙하게']].map(([id, label]) => <button key={id} className="chip" onClick={() => setNameOptions(suggestNames(idea, id))}>{label}</button>)}</div>{nameOptions.length > 0 && <div className="name-options">{nameOptions.map(n => <button key={n} className="chip" onClick={() => setName(n)}>{n}</button>)}</div>}<span className="section-label">저장 폴더</span><div className="folder-options">{library.folders.map(f => <button className={folderId === f.id ? 'selected' : ''} key={f.id} onClick={() => setFolderId(f.id)}><Folder size={16} /><span>{f.name}</span>{folderId === f.id && <Check size={16} />}</button>)}</div><form className="input-row folder-input" onSubmit={e => { e.preventDefault(); newFolder() }}><input aria-label="새 폴더 이름" placeholder="새 폴더 이름" maxLength={30} value={folderName} onChange={e => setFolderName(e.target.value)} /><button type="submit" className="small-action"><Plus size={16} />폴더</button></form><button className="primary" onClick={save}><Check size={18} />저장하기</button></section>}
        {screen === 'saved' && <section className="success-page"><div className="success-icon"><Check size={38} /></div><span className="eyebrow">A SPARK TO KEEP</span><h2>생각 하나를<br />담았어요.</h2><p className="muted">{idea?.name}<br />새로고침해도 이 브라우저에서 다시 볼 수 있어요.</p><button className="primary" onClick={() => { setFilterFolder(idea?.folderId || 'all'); navigate('archive') }}><Folder size={17} />보관함에서 확인하기</button><button className="secondary" onClick={quickStart}><Plus size={17} />새 아이디어 만들기</button></section>}
        {screen === 'archive' && <section><span className="eyebrow">YOUR IDEA COLLECTION</span><h2>모아둔 생각들<span className="green-dot">.</span></h2><p className="muted">저장한 아이디어 {library.ideas.length}개 · 이 브라우저에 보관</p><div className="archive-tools"><button className="text-button" onClick={exportLibrary}><Download size={14} />백업</button></div><label className="search"><Search size={17} /><input aria-label="아이디어 검색" placeholder="제목이나 단어로 찾아보기" value={search} onChange={e => setSearch(e.target.value)} /></label><div className="folder-filter"><button className={`chip ${filterFolder === 'all' ? 'active' : ''}`} onClick={() => setFilterFolder('all')}>전체</button>{library.folders.map(f => <button className={`chip ${filterFolder === f.id ? 'active' : ''}`} key={f.id} onClick={() => setFilterFolder(f.id)}>{f.name}</button>)}</div><div className="archive-list">{displayed.length ? displayed.map(record => <article className="saved-card" key={record.id}><button className="saved-open" onClick={() => openRecord(record)}><span className="saved-meta">{record.category} · {new Date(record.savedAt).toLocaleDateString('ko-KR')}</span><h3>{record.name}</h3><p>{record.one_liner}</p><WordTags words={record.used_words} /></button><button className="icon-button remove" aria-label={`${record.name} 삭제`} onClick={() => setModal({ type: 'delete', record })}><Trash2 size={16} /></button><span className="source-tag">{sourceLabel(record.source)}</span></article>) : <Empty title={library.ideas.length ? '조건에 맞는 아이디어가 없어요' : '아직 담아둔 생각이 없어요'} text={library.ideas.length ? '검색과 폴더 선택을 바꿔보세요.' : '아래 + 를 눌러 첫 아이디어를 만들어보세요.'} action={library.ideas.length ? () => { setSearch(''); setFilterFolder('all') } : quickStart} actionLabel={library.ideas.length ? '필터 초기화' : '주제 선택하고 만들기'} />}</div></section>}
        {idea && ['result', 'elaborate'].includes(screen) && <button className="text-button" onClick={copyResult}>현재 결과 복사하기</button>}
        {storageProblem && <div className="error-box" role="alert">{storageProblem}<button className="text-button" onClick={exportLibrary}>현재 내용 백업</button></div>}
        {error && <div className="error-box" role="alert"><b>한 번 더 확인해 주세요</b><p>{error}</p>{retryTask && screen !== 'save' && <button className="secondary" onClick={() => runGeneration(retryTask.type, retryTask.overrides)}>다시 시도</button>}</div>}
      </div>
      <nav className="bottom-tabs" aria-label="하단 메뉴"><button aria-label="홈 탭" aria-current={screen === 'home' ? 'page' : undefined} className={tab === 'home' && !['words','result','custom','loading','save','elaborate'].includes(screen) ? 'active' : ''} onClick={() => guarded(() => { setTab('home'); navigate('home') })}><Home size={22} /><span>홈</span></button><button className="plus-tab" aria-label="새 아이디어 주제 선택" disabled={busy} onClick={quickStart}><Plus size={30} /><span>새 아이디어</span></button><button aria-label="보관함 탭" aria-current={screen === 'archive' ? 'page' : undefined} className={tab === 'archive' ? 'active' : ''} onClick={() => guarded(() => { setTab('archive'); setFilterFolder('all'); navigate('archive') })}><span className="folder-icon"><Folder size={22} />{library.ideas.length > 0 && <small>{library.ideas.length}</small>}</span><span>보관함</span></button></nav>
    </main>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    {modal && <div className="modal-backdrop">
      <section className={`modal${modal.type === 'leave' ? ' leave-modal' : ''}`}
        style={modal.type === 'engine' ? { maxHeight: '85dvh', overflowY: 'auto' } : undefined}
        role="dialog" aria-modal="true" aria-labelledby="modal-title"
        aria-describedby={modal.type === 'leave' ? 'leave-description' : undefined}>
        <button className="icon-button close-modal" aria-label="대화상자 닫기" disabled={modelState === 'loading'} onClick={() => setModal(null)}><X size={20} /></button>
        {modal.type === 'leave' ? <LeaveDialog
          onSave={() => { setModal(null); openSave() }}
          onLeave={() => { const action = modal.action; setModal(null); action() }}
          onStay={() => setModal(null)} />
        : modal.type === 'delete' ? <>
          <h2 id="modal-title">보관함에서 지울까요?</h2><p className="muted">{modal.record.name}</p>
          <button className="primary" onClick={() => { const record = modal.record; if (persist({ ...library, ideas: library.ideas.filter(i => i.id !== record.id) })) { setModal(null); notify('삭제했어요.'); if (idea?.id === record.id) setIdea(null) } }}>삭제하기</button>
          <button className="secondary" onClick={() => setModal(null)}>취소</button>
        </> : modal.type === 'topic' ? <TopicPicker onSelect={selectTopic} onCancel={() => setModal(null)} />
        : <EngineSettings mode={mode} setMode={setMode} apiKey={apiKey} setApiKey={setApiKey} provider={provider} changeProvider={changeProvider} gpu={gpu} modelState={modelState} modelProgress={modelProgress} initAI={initAI}
          cancelPreparation={() => { preparation.current++; stopModel(); setModelState('idle'); setModelProgress({ progress: 0, text: '' }) }} close={() => setModal(null)} />}
      </section>
    </div>}
  </div>
}


function ConditionSummary({ value }) { return <aside className="condition condition-summary"><span><small>입력한 생성 조건</small><p>{value || '입력한 조건 없음'}</p></span></aside> }
function Back({ children, onClick }) { return <button className="back" onClick={onClick}><ArrowLeft size={16} />{children}</button> }
function WordTags({ words }) { return <div className="word-tags">{words.map((w, i) => <span key={i}>{w}</span>)}</div> }
function SourceLabel({ idea }) { return <span className="source-label" title={idea.model}><span className="status-dot" />{sourceLabel(idea.source)}</span> }
function ModeCaption({ mode }) { return <p className="hint">{mode === 'cloud' ? '입력 내용이 선택한 AI 제공업체로 전송되며 API 사용 비용이 발생할 수 있어요.' : mode === 'ai' ? '이 기기의 AI 모델이 직접 아이디어를 작성해요. 상단 설정에서 모델을 먼저 준비하세요.' : '규칙 기반 시연이에요. 조건은 기록용이며 생성 규칙에 적용되지 않아요. 직접 입력한 주제는 템플릿에만 연결하며 주제 적합성을 판단하지 않아요.'}</p> }
function Detail({ label, children }) { return <article className="detail-card"><h3>{label}</h3><div>{children}</div></article> }
function Empty({ title, text, action, actionLabel }) { return <div className="empty-state"><div className="empty-icon"><Folder size={28} /></div><h3>{title}</h3><p>{text}</p>{action && <button className="secondary" onClick={action}>{actionLabel}</button>}</div> }
createRoot(document.getElementById('root')).render(<App />)
