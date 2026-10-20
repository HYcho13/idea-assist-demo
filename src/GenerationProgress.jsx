import { useEffect, useState } from 'react'
import { elapsedSeconds, waitingMessage } from './demo/generation-feedback.js'

export default function GenerationProgress({ mode, provider }) {
  const [startedAt] = useState(() => performance.now())
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const update = () => setSeconds(elapsedSeconds(startedAt, performance.now()))
    const timer = window.setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    update()
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update) }
  }, [startedAt])
  return <div className="generation-progress">
    <p className="waiting-provider">{mode === 'cloud' ? `${provider === 'gemini' ? 'Google Gemini' : 'OpenAI'}에 응답을 요청했어요.` : '온디바이스 AI · 이 기기에서 실행 중'}</p>
    <p className="elapsed-time" aria-live="off">경과 시간 <span>{seconds}초</span></p>
    <p className="waiting-message" role="status" aria-live="polite">{waitingMessage(seconds, mode)}</p>
    <p className="waiting-note">진행률이 아닌 실제 대기 시간이에요.{mode === 'cloud' && ' 취소해도 이미 처리된 요청에는 비용이 발생할 수 있어요.'}</p>
  </div>
}
