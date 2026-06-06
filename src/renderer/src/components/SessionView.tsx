import React, { useState, useEffect, useRef } from 'react'
import { Code, Terminal, FolderOpen, Diamond, Bot, Brain } from 'lucide-react'
import type { Session } from '@shared/types'

interface Props {
  session: Session | null
  onKill: (id: string) => void
  onRestart: (id: string) => void
  onAddTab: (sessionId: string, type: 'agent' | 'terminal', command?: string) => void
  onCloseTab: (sessionId: string, tabId: string) => void
  onSwitchTab: (sessionId: string, tabId: string) => void
}

export function SessionView({ session, onKill, onRestart, onAddTab, onCloseTab, onSwitchTab }: Props): React.ReactElement {
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showOpenWith, setShowOpenWith] = useState(false)
  const [lastOpenWith, setLastOpenWith] = useState(() => localStorage.getItem('ow-last-open-with') ?? 'vscode')

  const openWithOptions = [
    { id: 'vscode', icon: <Code size={14} />, label: 'VS Code' },
    { id: 'terminal', icon: <Terminal size={14} />, label: 'Terminal' },
    { id: 'iterm', icon: <Terminal size={14} />, label: 'iTerm2' },
    { id: 'finder', icon: <FolderOpen size={14} />, label: 'Finder' },
    { id: 'obsidian', icon: <Diamond size={14} />, label: 'Obsidian' }
  ]

  const openWith = (app: string): void => {
    if (!session) return
    window.overwatch.sessions.openWith(app, session.workingDir)
    setLastOpenWith(app)
    localStorage.setItem('ow-last-open-with', app)
    setShowOpenWith(false)
  }

  const lastOption = openWithOptions.find(o => o.id === lastOpenWith) ?? openWithOptions[0]

  useEffect(() => {
    const close = (): void => { setShowOpenWith(false); setShowAddMenu(false) }
    if (showOpenWith || showAddMenu) {
      document.addEventListener('click', close)
      return () => document.removeEventListener('click', close)
    }
  }, [showOpenWith, showAddMenu])

  if (!session) {
    return (
      <div className="session-view empty-state">
        <div className="landing-hero">
          <img src={new URL('../assets/logo.png', import.meta.url).href} className="landing-logo" alt="" />
          <h1 className="landing-title">OVERWATCH</h1>
          <p className="landing-subtitle">Orchestrate parallel AI agents from a single pane of glass</p>
          <div className="landing-hints">
            <div className="landing-hint"><span className="hint-key">+</span> New session in sidebar</div>
            <div className="landing-hint"><span className="hint-key">⚡</span> Events appear in the agent pane</div>
            <div className="landing-hint"><span className="hint-key">🤖</span> Ask the Overwatch agent anything</div>
          </div>
        </div>
      </div>
    )
  }

  // No tabs — show landing page with tile options
  if (session.tabs.length === 0) {
    return (
      <div className="session-view">
        <div className="session-header">
          <div className="session-info">
            <h3>{session.name}</h3>
            <span className="session-path">{session.workingDir.replace(/^\/Users\/[^/]+/, '~')}</span>
          </div>
          <div className="session-actions">
            <div className="open-with-wrapper">
              <button className="btn-open-with" onClick={() => openWith(lastOption.id)} title={`Open in ${lastOption.label}`}>
                {lastOption.icon}
              </button>
              <button className="btn-open-with-caret" onClick={e => { e.stopPropagation(); setShowOpenWith(!showOpenWith) }}>▾</button>
              {showOpenWith && (
                <div className="open-with-menu">
                  {openWithOptions.map(opt => (
                    <button key={opt.id} className={opt.id === lastOpenWith ? 'active' : ''} onClick={() => openWith(opt.id)}>
                      <span className="ow-menu-icon">{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="new-tab-landing">
          <div className="new-tab-tiles">
            <button className="new-tab-tile" onClick={() => onAddTab(session.id, 'terminal')}>
              <span className="tile-icon"><Terminal size={28} /></span>
              <span className="tile-label">Terminal</span>
              <span className="tile-desc">Plain shell</span>
            </button>
            <button className="new-tab-tile" onClick={() => onAddTab(session.id, 'agent', 'kiro-cli chat')}>
              <span className="tile-icon"><Bot size={28} /></span>
              <span className="tile-label">Kiro</span>
              <span className="tile-desc">kiro-cli chat</span>
            </button>
            <button className="new-tab-tile" onClick={() => onAddTab(session.id, 'agent', 'claude')}>
              <span className="tile-icon"><Brain size={28} /></span>
              <span className="tile-label">Claude</span>
              <span className="tile-desc">claude code</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="session-view">
      <div className="session-header">
        <div className="session-info">
          <h3>{session.name}</h3>
          <span className="session-path">{session.workingDir.replace(/^\/Users\/[^/]+/, '~')}</span>
        </div>
        <div className="session-actions">
          <div className="open-with-wrapper">
            <button className="btn-open-with" onClick={() => openWith(lastOption.id)} title={`Open in ${lastOption.label}`}>
              <span>{lastOption.icon}</span>
            </button>
            <button className="btn-open-with-caret" onClick={e => { e.stopPropagation(); setShowOpenWith(!showOpenWith) }}>▾</button>
            {showOpenWith && (
              <div className="open-with-menu">
                {openWithOptions.map(opt => (
                  <button key={opt.id} className={opt.id === lastOpenWith ? 'active' : ''} onClick={() => openWith(opt.id)}>
                    <span className="ow-menu-icon">{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="tab-bar">
        {session.tabs.map(tab => (
          <div
            key={tab.id}
            className={`tab ${tab.id === session.activeTabId ? 'active' : ''}`}
            onClick={() => onSwitchTab(session.id, tab.id)}
          >
            <span className="tab-icon">{tab.type === 'agent' ? (tab.command?.includes('claude') ? <Brain size={14} /> : <Bot size={14} />) : <Terminal size={14} />}</span>
            <span className="tab-name">{tab.name}</span>
            <button
              className="tab-close"
              onClick={e => { e.stopPropagation(); onCloseTab(session.id, tab.id) }}
            >×</button>
          </div>
        ))}
        <div className="tab-add-wrapper">
          <button className="tab-add" onClick={e => { e.stopPropagation(); setShowAddMenu(!showAddMenu) }}>+</button>
          {showAddMenu && (
            <div className="tab-add-menu">
              <button onClick={() => { onAddTab(session.id, 'terminal'); setShowAddMenu(false) }}>
                <Terminal size={14} /> Terminal
              </button>
              <button onClick={() => { onAddTab(session.id, 'agent', 'kiro-cli chat'); setShowAddMenu(false) }}>
                <Bot size={14} /> Kiro
              </button>
              <button onClick={() => { onAddTab(session.id, 'agent', 'claude'); setShowAddMenu(false) }}>
                <Brain size={14} /> Claude
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
