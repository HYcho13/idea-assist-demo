export function elapsedSeconds(startedAt, now) {
  return Number.isFinite(startedAt) && Number.isFinite(now) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
}
export function waitingMessage(seconds, mode) {
  if (seconds >= 30) return '응답이 아직 도착하지 않았어요. 더 기다리거나 취소할 수 있어요.'
  if (seconds >= 10) return mode === 'cloud'
    ? '응답을 기다리는 중이에요. 제공업체 상황에 따라 더 걸릴 수 있어요.'
    : '이 기기에서 작업을 진행 중이에요. 기기 성능에 따라 더 걸릴 수 있어요.'
  return mode === 'cloud' ? 'AI 응답을 기다리고 있어요.' : '이 기기에서 AI 작업을 진행하고 있어요.'
}
