import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Cloud, Cpu, Sparkles } from 'lucide-react'
import { MODEL_ID } from './demo/ai.js'
import { CLOUD_MODEL } from './demo/cloud-ai.js'
import { GEMINI_MODEL, geminiVerifyKey } from './demo/gemini-ai.js'
import { providerName, readConsent, saveConsent, saveCloudProvider, validateCloudSettings } from './demo/cloud-settings.js'

export default function EngineSettings({ mode, setMode, apiKey, setApiKey, provider, changeProvider, gpu, modelState, modelProgress, initAI, cancelPreparation, close }) {
  const [page, setPage] = useState('engines')
  const [draftProvider, setDraftProvider] = useState(provider)
  const [draftKey, setDraftKey] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const pageRoot = useRef(null)
  const verification = useRef(0), verificationController = useRef(null)
  const [checking, setChecking] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState('')
  useEffect(() => () => { verification.current++; verificationController.current?.abort() }, [])
  function resetVerification() { verification.current++; verificationController.current?.abort(); setChecking(false); setConnectionStatus('') }
  useEffect(() => {
    pageRoot.current?.closest('[role="dialog"]')?.scrollTo({ top: 0 })
    pageRoot.current?.querySelector('h2')?.focus()
  }, [page])
  const loading = modelState === 'loading'
  const name = providerName(draftProvider)
  function openCredentials() {
    resetVerification()
    setDraftProvider(provider); setDraftKey(apiKey); setConsent(readConsent(provider)); setError(''); setPage('credentials')
  }
  function selectProvider(value) {
    resetVerification()
    setDraftProvider(value); setDraftKey(value === provider ? apiKey : ''); setConsent(readConsent(value)); setError('')
  }
  function backToEngines() { resetVerification(); setDraftKey(''); setError(''); setPage('engines') }
  async function verifyConnection() {
    if(checking) return
    let key
    try { key = validateCloudSettings(draftProvider, draftKey, consent) } catch (failure) { setError(failure.message); return }
    const ticket=++verification.current, controller=new AbortController()
    verificationController.current=controller; setChecking(true); setError(''); setConnectionStatus('Google에 키 인증과 모델 정보를 확인하는 중…')
    try {
      const result=await geminiVerifyKey({ apiKey:key,signal:controller.signal })
      if(ticket===verification.current) setConnectionStatus(result)
    } catch(failure) { if(ticket===verification.current) { setConnectionStatus(''); setError(failure.message) } }
    finally { if(ticket===verification.current) { setChecking(false); verificationController.current=null } }
  }
  function save() {
    if(checking) return
    try {
      const key = validateCloudSettings(draftProvider, draftKey, consent)
      saveConsent(draftProvider, consent)
      saveCloudProvider(draftProvider)
      changeProvider(draftProvider); setApiKey(key); setMode('cloud')
      setDraftKey(''); setSaved(true); setPage('engines'); setError('')
    } catch (failure) { setError(failure.message) }
  }
  if (page === 'credentials') return <section className="cloud-key-page" ref={pageRoot}>
    <button className="back" onClick={backToEngines}><ArrowLeft size={16} />생성 방식</button>
    <span className="eyebrow">PERSONAL API KEY</span><h2 id="modal-title" tabIndex={-1}>개인 API 키 입력</h2>
    <p className="muted">제공업체와 키를 확인하고 설정을 저장하세요.</p>
    <form onSubmit={event => { event.preventDefault(); save() }}>
      <div className="engine-detail">
        <label className="field">클라우드 AI 제공업체<select value={draftProvider} onChange={event => selectProvider(event.target.value)}><option value="openai">OpenAI</option><option value="gemini">Google Gemini · AI Studio</option></select></label>
        <p className="model-id">{name} · {draftProvider === 'gemini' ? GEMINI_MODEL : CLOUD_MODEL}</p>
        <label className="field">개인 API 키 · {name}<input type="password" name="classroom-api-key" value={draftKey} maxLength={draftProvider === 'gemini' ? undefined : 512} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="cloud-consent" placeholder="선택한 제공업체의 전체 키 · 저장하지 않음" onChange={event => { resetVerification(); setDraftKey(event.target.value); setError('') }} /></label>
        <p className="hint">업체별 키는 서로 호환되지 않아요. 저장 전 돌아가면 변경 내용은 적용되지 않아요.</p>
        {draftProvider === 'gemini' && <p className="hint">AI Studio의 복사 버튼으로 전체 키를 복사하세요. 따옴표·변수 이름·가려진 키는 사용할 수 없어요. 긴 키도 자동으로 자르지 않아요.</p>}
      </div>
      <div className="engine-detail">
        <h3>전송·비용 안내</h3>
        <p id="cloud-consent">세 단어, 입력 주제·분야, 조건, 현재 아이디어와 발전 방향이 {name}로 전송돼요. API 사용 비용이 발생할 수 있으며 취소 전 처리된 요청에도 비용이 생길 수 있어요. 제공업체별 데이터 정책이 적용돼요.</p>
        <label className="consent-row"><input type="checkbox" checked={consent} onChange={event => { resetVerification(); setConsent(event.target.checked) }} /><span>{name} 전송과 API 비용에 동의합니다</span></label>
        <p className="hint">저장한 동의는 제공업체별로 유지돼요. 키는 현재 페이지 메모리에만 두며 새로고침하면 사라져요. 공용 키를 배포하지 마세요.</p>
      </div>
      {error && <p className="error-inline" role="alert">{error}</p>}
      {draftProvider === 'gemini' && <><button className="secondary" type="button" disabled={checking || !draftKey.trim() || !consent} onClick={verifyConnection}>{checking ? '연결 확인 중…' : 'Gemini 연결 확인 · 생성 없이'}</button>{connectionStatus && <p className="hint" role="status">{connectionStatus}</p>}</>}
      <button className="primary" type="submit" disabled={checking || !draftKey.trim() || !consent}><Check size={18} />설정 저장하기</button>
      <p className="hint">저장은 키 인증이나 유료 요청을 실행하지 않아요. 실제 호출은 아이디어를 생성할 때 진행해요.</p>
    </form>
  </section>
  return <section className="engine-overview" ref={pageRoot}>
    <span className="eyebrow">CHOOSE YOUR ENGINE</span><h2 id="modal-title" tabIndex={-1}>생각을 만드는 방식</h2>
    <p className="muted">규칙 시연, 이 기기의 AI, 클라우드 AI 중 직접 선택하세요.</p>
    {saved && <p className="settings-saved" role="status"><Check size={16} />클라우드 설정을 저장했어요. 키 인증은 생성 시 확인해요.</p>}
    <button className={`engine-choice ${mode === 'local' ? 'selected' : ''}`} disabled={loading} aria-pressed={mode === 'local'} onClick={() => setMode('local')}><Sparkles size={22} /><span><b>간편 시연</b><small>규칙 조합 · 즉시 사용 · AI 추론 없음</small></span>{mode === 'local' && <Check size={19} />}</button>
    <button className={`engine-choice ${mode === 'ai' ? 'selected' : ''}`} disabled={loading} aria-pressed={mode === 'ai'} onClick={() => setMode('ai')}><Cpu size={22} /><span><b>온디바이스 AI</b><small>이 기기의 모델로 직접 생성</small></span>{mode === 'ai' && <Check size={19} />}</button>
    <button className={`engine-choice ${mode === 'cloud' ? 'selected' : ''}`} disabled={loading} onClick={openCredentials}><Cloud size={22} /><span><b>클라우드 AI</b><small>OpenAI · Google Gemini / 개인 API 키 설정</small></span><ArrowRight size={19} /></button>
    <div className="engine-detail"><h3>온디바이스 모델 준비</h3>
      <p>Qwen2.5 1.5B Instruct 모델을 내려받아 이 기기에서 생성·발전·구체화를 수행해요. 한국어 품질과 속도에는 한계가 있어요.</p>
      <p className="muted">WebGPU와 약 1.9GB GPU 메모리가 필요해요. 저사양 기기에서는 준비가 실패할 수 있어요. 생성은 90초 제한이에요.</p>
      <div className="gpu-status">{gpu === null ? 'GPU 확인 중' : gpu ? '✓ WebGPU 사용 가능 · 메모리 여유는 별도 확인 필요' : '이 브라우저에서 WebGPU 사용 불가'}</div>
      {loading && <><progress max={1} value={modelProgress.progress} /><p className="model-progress">{modelProgress.text}</p><button className="secondary" onClick={cancelPreparation}>모델 준비 취소</button></>}
      {modelState === 'error' && <p className="error-inline" role="alert">{modelProgress.text}</p>}
      {!loading && <button className="primary" disabled={gpu !== true} onClick={modelState === 'ready' ? () => { setMode('ai'); close() } : initAI}>{modelState === 'ready' ? '준비된 온디바이스 AI 사용' : '온디바이스 모델 준비하기'}</button>}
      <small className="model-id">{MODEL_ID}</small>
    </div>
    <button className="text-button" disabled={loading} onClick={close}>설정 마치기</button>
  </section>
}
