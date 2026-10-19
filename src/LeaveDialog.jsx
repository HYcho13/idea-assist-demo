import React from 'react'
import { Folder } from 'lucide-react'

export default function LeaveDialog({ onSave, onLeave, onStay }) {
  return <div className="leave-content">
    <span className="leave-icon" aria-hidden="true"><Folder size={26} /></span>
    <h2 id="modal-title">이 생각을<br />저장할까요?</h2>
    <p className="muted" id="leave-description">아직 보관함에 저장하지 않았어요.<br />지금 내용을 저장하거나, 저장하지 않고 이동할 수 있어요.</p>
    <div className="leave-actions">
      <button className="primary" onClick={onSave}>저장하러 가기</button>
      <button className="secondary leave-discard" onClick={onLeave}>저장하지 않고 이동</button>
      <button className="text-button" onClick={onStay}>계속 다듬기</button>
    </div>
  </div>
}
