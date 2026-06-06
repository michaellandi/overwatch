import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Bot, Brain, Terminal as TerminalIcon } from 'lucide-react'
import type { Session } from '@shared/types'

const STATE_ICONS: Record<Session['state'], string> = {
  working: '●',
  blocked: '◉',
  done: '○'
}

const ADJECTIVES = ['cosmic', 'sneaky', 'turbo', 'chunky', 'radical', 'sleepy', 'zappy', 'wobbly', 'funky', 'spicy']
const NOUNS = ['penguin', 'taco', 'robot', 'wizard', 'potato', 'narwhal', 'waffle', 'llama', 'gopher', 'toaster']

function randomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj}-${noun}`
}

interface Props {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onCreate: (goal: string, dir: string, agent?: string, initialPrompt?: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
}

export function Sidebar({ sessions, activeSessionId, onSelect, onCreate, onDelete, onRename }: Props): React.ReactElement {
  const [goal, setGoal] = useState('')
  const [dir, setDir] = useState('')
  const [agent, setAgent] = useState('kiro')
  const [initialPrompt, setInitialPrompt] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ow-sidebar-collapsed') === 'true')
  const [width, setWidth] = useState(() => Number(localStorage.getItem('ow-sidebar-width')) || 220)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const resizing = useRef(false)

  const submit = (): void => {
    const finalGoal = goal.trim() || randomName()
    onCreate(finalGoal, dir.trim() || '~', agent, initialPrompt.trim() || undefined)
    setGoal('')
    setDir('')
    setAgent('kiro')
    setInitialPrompt('')
    setShowForm(false)
  }

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: MouseEvent): void => {
      if (!resizing.current) return
      const newWidth = Math.max(140, Math.min(400, startWidth + ev.clientX - startX))
      setWidth(newWidth)
      localStorage.setItem('ow-sidebar-width', String(newWidth))
    }
    const onUp = (): void => {
      resizing.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width])

  if (collapsed) {
    return (
      <aside className="sidebar collapsed">
        <button className="btn-collapse" onClick={() => { setCollapsed(false); localStorage.setItem('ow-sidebar-collapsed', 'false') }} title="Expand">▶</button>
      </aside>
    )
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-header">
        <button className="btn-collapse" onClick={() => { setCollapsed(true); localStorage.setItem('ow-sidebar-collapsed', 'true') }} title="Collapse">◀</button>
        <h2>Sessions</h2>
        <button className="btn-new" onClick={() => setShowForm(!showForm)}>+</button>
      </div>
      {showForm && (
        <div className="settings-overlay" onClick={() => setShowForm(false)}>
          <div className="settings-panel" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">New Session</h3>
            <div className="settings-content">
              <div className="settings-field">
                <label>Goal</label>
                <input
                  type="text"
                  placeholder="Optional — e.g. Refactor auth"
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  autoFocus
                />
              </div>
              <div className="settings-field">
                <label>Directory</label>
                <div className="settings-dir-row">
                  <input
                    type="text"
                    placeholder="~"
                    value={dir}
                    onChange={e => setDir(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submit()}
                  />
                  <button onClick={async () => { const picked = await window.overwatch.sessions.pickDir(); if (picked) setDir(picked) }}>Browse</button>
                </div>
              </div>
              <div className="settings-field">
                <label>Agent</label>
                <div className="agent-picker">
                  {[
                    { id: 'kiro', icon: <Bot size={14} />, label: 'Kiro' },
                    { id: 'claude', icon: <Brain size={14} />, label: 'Claude' },
                    { id: 'terminal', icon: <TerminalIcon size={14} />, label: 'Terminal' }
                  ].map(opt => (
                    <button
                      key={opt.id}
                      className={`agent-option ${agent === opt.id ? 'active' : ''}`}
                      onClick={() => setAgent(opt.id)}
                    >
                      {opt.icon}
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-field">
                <label>Initial Prompt <span className="settings-help-inline">(optional)</span></label>
                <textarea
                  className="initial-prompt-input"
                  placeholder="e.g. Refactor the auth middleware to use async/await"
                  value={initialPrompt}
                  onChange={e => setInitialPrompt(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
            <div className="settings-actions">
              <button className="btn-settings-cancel" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-settings-save" onClick={submit}>Create</button>
            </div>
          </div>
        </div>
      )}
      <div className="session-list">
        {Object.entries(
          sessions.reduce<Record<string, Session[]>>((groups, s) => {
            (groups[s.workingDir] ??= []).push(s)
            return groups
          }, {})
        ).map(([dir, group]) => (
          <div key={dir} className="session-group">
            <div className="session-group-header" title={dir}>
              {dir.split('/').filter(Boolean).pop() || dir}
            </div>
            {group.map(s => (
              <li
                key={s.id}
                className={`session-item ${s.state === 'blocked' && s.blockedReason ? `blocked-${s.blockedReason}` : s.state} ${s.id === activeSessionId ? 'active' : ''}`}
                onClick={() => onSelect(s.id)}
              >
                {s.thinking ? <span className="thinking-indicator" /> : <span className="state-icon">{STATE_ICONS[s.state]}</span>}
                {editingId === s.id ? (
                  <input
                    className="session-rename-input"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { onRename(s.id, editName); setEditingId(null) }
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    onBlur={() => { onRename(s.id, editName); setEditingId(null) }}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="session-name"
                    onDoubleClick={e => { e.stopPropagation(); setEditingId(s.id); setEditName(s.name) }}
                  >{s.name}</span>
                )}
                <button
                  className="session-delete"
                  onClick={e => {
                    e.stopPropagation()
                    if (confirm(`Delete session "${s.name}"?`)) onDelete(s.id)
                  }}
                  title="Delete"
                >✕</button>
              </li>
            ))}
          </div>
        ))}
      </div>
      <div className="resize-handle" onMouseDown={startResize} />
    </aside>
  )
}
