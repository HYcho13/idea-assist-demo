import { CONDITION_MAX_LENGTH, conditionError } from './demo/condition.js'

export default function ConditionField({ value, onChange }) {
  const error = conditionError(value)
  return <div className="condition-entry">
    <label className="field" htmlFor="idea-condition">아이디어 생성 조건 <span className="optional-label">선택</span></label>
    <input id="idea-condition" type="text" value={value} maxLength={CONDITION_MAX_LENGTH}
      placeholder="예: 1인 가구를 위한 서비스" aria-invalid={Boolean(error)}
      aria-describedby="condition-help condition-count condition-error" enterKeyHint="done"
      onChange={event => onChange(event.target.value)} />
    <div className="condition-meta"><p id="condition-help">비워 두어도 생성할 수 있어요.</p><span id="condition-count">{value.length}/{CONDITION_MAX_LENGTH}</span></div>
    <p id="condition-error" className="condition-error" role={error ? 'alert' : undefined}>{error}</p>
  </div>
}
