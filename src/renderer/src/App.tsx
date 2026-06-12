import React, { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { SessionView } from './components/SessionView'
import { TerminalView } from './components/TerminalView'
import { OverwatchPane } from './components/OverwatchPane'
import { Settings } from './components/Settings'
import type { Session } from '@shared/types'

export function App(): React.ReactElement {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => localStorage.getItem('ow-active-session'))
  const [showSettings, setShowSettings] = useState(false)
  const [showSetup, setShowSetup] = useState(false)

  useEffect(() => {
    if (activeSessionId) localStorage.setItem('ow-active-session', activeSessionId)
    else localStorage.removeItem('ow-active-session')
  }, [activeSessionId])

  useEffect(() => {
    window.overwatch.settings.get().then(s => { if (s.isFirstRun) setShowSetup(true) })
    window.overwatch.sessions.list().then(list => {
      setSessions(list)
      const stored = localStorage.getItem('ow-active-session')
      if (stored && list.some(s => s.id === stored)) setActiveSessionId(stored)
      else if (list.length > 0) setActiveSessionId(list[0].id)
    })

    // Refresh sessions when orchestrator events fire (session state may have changed)
    window.overwatch.orchestrator.onEvent((event: unknown) => {
      const e = event as { type: string; sessionId?: string }
      // Only full refresh for structural changes (kill/create)
      if (e.type === 'session:killed' || e.type === 'session:created') {
        window.overwatch.sessions.list().then(setSessions)
      } else if (e.sessionId) {
        // For state changes, just update that session's state
        setSessions(prev => prev.map(s => {
          if (s.id !== e.sessionId) return s
          const isBlocked = e.type === 'session:approval' || e.type === 'session:idle'
          const blockedReason = e.type === 'session:idle' ? 'idle' : e.type === 'session:approval' ? 'approval' : undefined
          if (isBlocked) return { ...s, state: 'blocked' as const, blockedReason }
          if (e.type === 'session:resumed') return { ...s, state: 'working' as const, blockedReason: undefined }
          return s
        }))
      }
    })

    // Track thinking state
    window.overwatch.terminal.onThinking((sessionId: string, thinking: boolean) => {
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, thinking } : s))
    })
  }, [])

  const handleCreate = useCallback(async (goal: string, dir: string, agent?: string, initialPrompt?: string) => {
    try {
      const session = await window.overwatch.sessions.create(goal, dir, agent, initialPrompt)
      setSessions(prev => [...prev, session])
      setActiveSessionId(session.id)
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }, [])

  const handleKill = useCallback(async (sessionId: string) => {
    await window.overwatch.sessions.kill(sessionId)
    setSessions(prev => prev.filter(s => s.id !== sessionId))
    setActiveSessionId(prev => prev === sessionId ? null : prev)
  }, [])

  const handleRestart = useCallback(async (sessionId: string) => {
    const session = await window.overwatch.sessions.restart(sessionId)
    setSessions(prev => prev.map(s => s.id === sessionId ? session : s))
  }, [])

  const handleAddTab = useCallback(async (sessionId: string, type: 'agent' | 'terminal', command?: string) => {
    const tab = await window.overwatch.tabs.add(sessionId, type, command)
    if (tab) {
      setSessions(prev => prev.map(s => {
        if (s.id !== sessionId) return s
        return { ...s, tabs: [...s.tabs, tab], activeTabId: tab.id }
      }))
    }
  }, [])

  const handleCloseTab = useCallback(async (sessionId: string, tabId: string) => {
    await window.overwatch.tabs.close(sessionId, tabId)
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s
      const tabs = s.tabs.filter(t => t.id !== tabId)
      const activeTabId = s.activeTabId === tabId ? (tabs[0]?.id ?? '') : s.activeTabId
      return { ...s, tabs, activeTabId }
    }))
  }, [])

  const handleSwitchTab = useCallback((sessionId: string, tabId: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s
      return { ...s, activeTabId: tabId }
    }))
    window.overwatch.sessions.switchTab(sessionId, tabId)
  }, [])

  const handleRename = useCallback((sessionId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name: trimmed } : s))
    window.overwatch.sessions.rename(sessionId, trimmed)
  }, [])

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null

  return (
    <div className="app">
      <div className="titlebar">
        <img src={new URL('./assets/logo.png', import.meta.url).href} className="titlebar-logo" alt="" />
        <span className="titlebar-text">OVERWATCH</span>
        <button className="btn-titlebar-settings" onClick={() => setShowSettings(true)}>⚙</button>
      </div>
      <div className="app-body">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={setActiveSessionId}
        onCreate={handleCreate}
        onDelete={handleKill}
        onRename={handleRename}
      />
      <div className="main-area">
        <SessionView
          session={activeSession}
          onKill={handleKill}
          onRestart={handleRestart}
          onAddTab={handleAddTab}
          onCloseTab={handleCloseTab}
          onSwitchTab={handleSwitchTab}
        />
        {/* Render ALL terminals persistently, show/hide based on active session+tab */}
        <div className="terminals-layer">
          {sessions.map(s =>
            s.tabs.map(tab => (
              <TerminalView
                key={tab.id}
                tabId={tab.id}
                visible={s.id === activeSessionId && tab.id === s.activeTabId}
              />
            ))
          )}
        </div>
        <OverwatchPane onSelectSession={(id, tabId) => {
          setActiveSessionId(id)
          if (tabId) handleSwitchTab(id, tabId)
        }} />
      </div>
      </div>
      <Settings open={showSettings} onClose={() => setShowSettings(false)} />
      {showSetup && <SetupWizard onComplete={() => setShowSetup(false)} />}
    </div>
  )
}

function SetupWizard({ onComplete }: { onComplete: () => void }): React.ReactElement {
  const [profile, setProfile] = useState('default')
  const [region, setRegion] = useState('us-west-2')

  const save = async (): Promise<void> => {
    const current = await window.overwatch.settings.get()
    await window.overwatch.settings.set({ ...current, awsProfile: profile, awsRegion: region })
    onComplete()
  }

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <h3 className="modal-title">Welcome to Overwatch</h3>
        <div className="settings-content">
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>
            Configure your AWS credentials to connect to Bedrock. You can change these later in Settings.
          </p>
          <div className="settings-field">
            <label>AWS Profile</label>
            <input type="text" value={profile} onChange={e => setProfile(e.target.value)} placeholder="default" />
          </div>
          <div className="settings-field">
            <label>AWS Region</label>
            <select value={region} onChange={e => setRegion(e.target.value)}>
              <option value="us-east-1">us-east-1</option>
              <option value="us-west-2">us-west-2</option>
              <option value="eu-west-1">eu-west-1</option>
              <option value="eu-central-1">eu-central-1</option>
              <option value="ap-northeast-1">ap-northeast-1</option>
              <option value="ap-southeast-1">ap-southeast-1</option>
            </select>
          </div>
        </div>
        <div className="settings-actions">
          <button className="btn-settings-save" onClick={save}>Get Started</button>
        </div>
      </div>
    </div>
  )
}
