import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronRight, PencilLine } from 'lucide-react'
import { categories } from './demo/data.js'
import { validateTopic } from './demo/topic.js'

export default function TopicPicker({ onGenerate, onCancel }) {
  const [page, setPage] = useState('choices')
  const [topic, setTopic] = useState('')
  const [error, setError] = useState('')
  const input = useRef(null)
  const title = useRef(null)
  useEffect(() => {
    if (page === 'input') input.current?.focus()
    else title.current?.focus()
  }, [page])
  function submit(event) {
    event.preventDefault()
    try { onGenerate('custom', validateTopic(topic)) } catch (failure) { setError(failure.message) }
  }
  return <section className="topic-picker">
    {page === 'input' && <button className="back topic-back" aria-label="선택지로 돌아가기" onClick={() => { setPage('choices'); setError('') }}><ArrowLeft size={20} aria-hidden="true" /></button>}
    <h2 id="modal-title" ref={title} tabIndex={-1}>{page === 'choices' ? '어떤 주제로 만들까요?' : '나만의 주제를 적어주세요'}</h2>
    {page === 'choices' ? <>
      <p className="muted" id="topic-picker-help">분야를 고르면 세 단어를 뽑아 바로 생성해요.</p>
      <div className="topic-choices" role="group" aria-label="아이디어 주제 선택">
        {categories.map(category => <button type="button" className="topic-choice" key={category.id} onClick={() => onGenerate(category.id, '')}>
          <span className="topic-choice-icon" aria-hidden="true">{category.icon}</span><span><b>{category.name}</b><small>{category.description}</small></span><ChevronRight size={18} aria-hidden="true" />
        </button>)}
        <button type="button" className="topic-choice" onClick={() => setPage('input')}><span className="topic-choice-icon"><PencilLine size={22} /></span><span><b>직접 입력</b><small>원하는 주제·분야를 자유롭게 작성</small></span><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
      <button type="button" className="secondary" onClick={onCancel}>취소</button>
    </> : <form onSubmit={submit}>
      <label className="field">주제·분야<input ref={input} value={topic} maxLength={80} placeholder="예: 반려동물과 함께하는 여행" enterKeyHint="go" aria-describedby="new-topic-help new-topic-count" aria-invalid={Boolean(error)} onChange={event => { setTopic(event.target.value); setError('') }} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} /></label>
      <p className="hint" id="new-topic-help">1~80자로 적어주세요. 입력한 주제 안에서 세 단어를 연결해요.</p>
      <p className="topic-count" id="new-topic-count">{topic.length}/80</p>
      {error && <p className="error-inline" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={!topic.trim()}>이 주제로 생성하기<ArrowRight size={18} /></button>
      <button type="button" className="secondary" onClick={onCancel}>취소</button>
    </form>}
  </section>
}
