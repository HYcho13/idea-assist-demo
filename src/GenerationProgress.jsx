export default function GenerationProgress({ mode }) {
  return <div className="generation-progress">
    <div role="status" aria-label="AI 응답을 기다리고 있어요.">
      <span className="generation-spinner" aria-hidden="true" />
    </div>
    {mode === 'cloud' && <p className="waiting-note">취소해도 이미 처리된 요청에는 비용이 발생할 수 있어요.</p>}
  </div>
}
