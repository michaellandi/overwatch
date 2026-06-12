import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Code, Terminal as TerminalIcon, FolderOpen, Diamond } from 'lucide-react'
import Markdown from 'react-markdown'

function playDing(): void {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.frequency.value = 880
  osc.type = 'sine'
  gain.gain.setValueAtTime(0.3, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
  osc.start()
  osc.stop(ctx.currentTime + 0.3)
}

interface Message {
  id: string
  timestamp: number
  from: 'orchestrator' | 'user'
  content: string
  streaming?: boolean
  queued?: boolean
  sessionId?: string
  tabId?: string
}

function ToolBubble({ name, input, result }: { name: string; input: string; result: string }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const hasResult = result.length > 0

  return (
    <div className={`tool-bubble ${hasResult ? 'complete' : 'pending'} ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded(!expanded)}>
      <div className="tool-bubble-header">
        <span className="tool-icon">{hasResult ? '✓' : '⏳'}</span>
        <span className="tool-name">{name}</span>
        <span className="tool-expand">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="tool-bubble-detail">
          {input && <div className="tool-section"><span className="tool-section-label">Input:</span><pre>{input}</pre></div>}
          {result && <div className="tool-section"><span className="tool-section-label">Output:</span><pre>{result}</pre></div>}
        </div>
      )}
    </div>
  )
}

export function OverwatchPane({ onSelectSession }: { onSelectSession?: (id: string, tabId?: string) => void }): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem('ow-chat-history')
      if (saved) return JSON.parse(saved)
    } catch {}
    return [{ id: 'welcome', timestamp: Date.now(), from: 'orchestrator', content: 'Ready. Ask me about your sessions or tell me what to do.' }]
  })
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [height, setHeight] = useState(() => Number(localStorage.getItem('ow-pane-height')) || 220)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ow-pane-collapsed') === 'true')
  const [showOpenWith, setShowOpenWith] = useState(false)
  const [lastOpenWith, setLastOpenWith] = useState(() => localStorage.getItem('ow-last-open-with') ?? 'vscode')
  const bottomRef = useRef<HTMLDivElement>(null)
  const resizing = useRef(false)

  const openWithOptions = [
    { id: 'vscode', icon: <Code size={14} />, label: 'VS Code' },
    { id: 'terminal', icon: <TerminalIcon size={14} />, label: 'Terminal' },
    { id: 'iterm', icon: <TerminalIcon size={14} />, label: 'iTerm2' },
    { id: 'finder', icon: <FolderOpen size={14} />, label: 'Finder' },
    { id: 'obsidian', icon: <Diamond size={14} />, label: 'Obsidian' }
  ]

  const openWithCtx = (app: string): void => {
    window.overwatch.sessions.openWith(app, '')
    setLastOpenWith(app)
    localStorage.setItem('ow-last-open-with', app)
    setShowOpenWith(false)
  }

  // Persist messages
  useEffect(() => {
    const toSave = messages.filter(m => !m.streaming).slice(-100) // keep last 100
    localStorage.setItem('ow-chat-history', JSON.stringify(toSave))
  }, [messages])

  const clearHistory = useCallback(() => {
    setMessages([{ id: 'welcome', timestamp: Date.now(), from: 'orchestrator', content: 'Ready. Ask me about your sessions or tell me what to do.' }])
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    window.overwatch.orchestrator.onEvent((event: unknown) => {
      const e = event as { type: string; summary?: string; sessionId?: string; tabId?: string }
      // Only show actionable events in chat pane
      if (e.type === 'session:approval') {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          from: 'orchestrator',
          content: e.summary ?? e.type,
          sessionId: e.sessionId,
          tabId: e.tabId
        }])
      }
      // Play ding for blocked events if enabled
      if (e.type === 'session:approval' || e.type === 'session:idle') {
        if (localStorage.getItem('ow-sound-enabled') !== 'false') {
          playDing()
        }
      }
    })

    window.overwatch.orchestrator.onChatStream((chunk: string) => {
      setMessages(prev => {
        // Find the last streaming orchestrator message
        const idx = [...prev].reverse().findIndex(m => m.from === 'orchestrator' && m.streaming)
        if (idx >= 0) {
          const realIdx = prev.length - 1 - idx
          const msg = prev[realIdx]
          return [...prev.slice(0, realIdx), { ...msg, content: msg.content + chunk }, ...prev.slice(realIdx + 1)]
        }
        // No streaming message found — create one
        return [...prev, { id: crypto.randomUUID(), timestamp: Date.now(), from: 'orchestrator' as const, content: chunk, streaming: true }]
      })
    })

    window.overwatch.orchestrator.onChatDone(() => {
      setIsStreaming(false)
      setMessages(prev =>
        prev
          .filter(m => !(m.from === 'orchestrator' && m.streaming && !m.content)) // remove empty streaming
          .map(m => m.streaming ? { ...m, streaming: false } : m) // mark all as done
      )
    })

    window.overwatch.orchestrator.onToolCall((data: { name: string; input: string }) => {
      let inputSummary = ''
      try { const parsed = JSON.parse(data.input); inputSummary = Object.entries(parsed).map(([k, v]) => `${k}: ${String(v).slice(0, 50)}`).join(', ') } catch {}
      setMessages(prev => [
        // Close any current streaming message and remove empty ones
        ...prev
          .map(m => m.streaming ? { ...m, streaming: false } : m)
          .filter(m => !(m.from === 'orchestrator' && !m.content && !m.content.startsWith('__TOOL__'))),
        {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          from: 'orchestrator' as const,
          content: `__TOOL__${data.name}__${inputSummary}__`
        }
      ])
    })

    window.overwatch.orchestrator.onToolResult((data: { name: string; result: string }) => {
      // Append result to the last tool call message for this tool
      setMessages(prev => {
        const idx = [...prev].reverse().findIndex(m => m.content.startsWith(`__TOOL__${data.name}__`) && m.content.endsWith('__'))
        if (idx >= 0) {
          const realIdx = prev.length - 1 - idx
          const msg = prev[realIdx]
          return [
            ...prev.slice(0, realIdx),
            { ...msg, content: msg.content + data.result },
            ...prev.slice(realIdx + 1)
          ]
        }
        return prev
      })
    })
  }, [])

  const send = useCallback(() => {
    if (!input.trim()) return
    const userMsg = input
    const msgId = crypto.randomUUID()
    setInput('')

    setMessages(prev => [
      ...prev,
      { id: msgId, timestamp: Date.now(), from: 'user', content: userMsg, queued: isStreaming },
      { id: crypto.randomUUID(), timestamp: Date.now(), from: 'orchestrator', content: '', streaming: true }
    ])
    setIsStreaming(true)

    window.overwatch.orchestrator.chat(userMsg)
  }, [input, isStreaming])

  const cancelMessage = useCallback(async (id: string) => {
    const cancelled = await window.overwatch.orchestrator.cancel(id)
    if (cancelled) {
      setMessages(prev => prev.filter(m => m.id !== id))
    }
  }, [])

  const [history] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ow-prompt-history') ?? '[]') } catch { return [] }
  })
  const [historyIdx, setHistoryIdx] = useState(-1)

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (input.trim()) {
        history.unshift(input.trim())
        if (history.length > 50) history.pop()
        localStorage.setItem('ow-prompt-history', JSON.stringify(history))
        setHistoryIdx(-1)
      }
      send()
    } else if (e.key === 'ArrowUp' && !input) {
      e.preventDefault()
      const next = Math.min(historyIdx + 1, history.length - 1)
      setHistoryIdx(next)
      if (history[next]) setInput(history[next])
    } else if (e.key === 'ArrowDown' && historyIdx >= 0) {
      e.preventDefault()
      const next = historyIdx - 1
      setHistoryIdx(next)
      setInput(next >= 0 ? history[next] : '')
    }
  }

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    const startY = e.clientY
    const startHeight = height
    const onMove = (ev: MouseEvent): void => {
      if (!resizing.current) return
      const newHeight = Math.max(120, Math.min(600, startHeight - (ev.clientY - startY)))
      setHeight(newHeight)
      localStorage.setItem('ow-pane-height', String(newHeight))
    }
    const onUp = (): void => {
      resizing.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [height])

  if (collapsed) {
    return (
      <div className="overwatch-pane collapsed">
        <div className="overwatch-header">
          <span className="overwatch-title">🤖 OVERWATCH AGENT</span>
          <button className="btn-pane-toggle" onClick={() => { setCollapsed(false); localStorage.setItem('ow-pane-collapsed', 'false') }}>▲</button>
        </div>
      </div>
    )
  }

  return (
    <div className="overwatch-pane" style={{ height }}>
      <div className="overwatch-resize" onMouseDown={startResize} />
      <div className="overwatch-header">
        <span className="overwatch-title">🤖 OVERWATCH AGENT</span>
        <div className="overwatch-header-actions">
          <div className="open-with-wrapper">
            <button className="btn-open-with" onClick={() => window.overwatch.sessions.openWith(lastOpenWith, '')} title={`Open in ${openWithOptions.find(o => o.id === lastOpenWith)?.label}`}>
              {openWithOptions.find(o => o.id === lastOpenWith)?.icon}
            </button>
            <button className="btn-open-with-caret" onClick={e => { e.stopPropagation(); setShowOpenWith(!showOpenWith) }}>▾</button>
            {showOpenWith && (
              <div className="open-with-menu">
                {openWithOptions.map(opt => (
                  <button key={opt.id} className={opt.id === lastOpenWith ? 'active' : ''} onClick={() => openWithCtx(opt.id)}>
                    <span className="ow-menu-icon">{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="btn-pane-clear" onClick={clearHistory} title="Clear history">🗑</button>
          <button className="btn-pane-toggle" onClick={() => { setCollapsed(true); localStorage.setItem('ow-pane-collapsed', 'true') }}>▼</button>
        </div>
      </div>
      <div className="overwatch-messages">
        {messages.map(m => (
          <div key={m.id} className={`chat-message ${m.from}`}>
            {m.from === 'orchestrator' ? (
              m.content.startsWith('__TOOL__') ? (() => {
                const parts = m.content.slice(8).split('__')
                const name = parts[0]
                const input = parts[1] ?? ''
                const result = parts.slice(2).join('__')
                return <ToolBubble name={name} input={input} result={result} />
              })() : m.sessionId && onSelectSession ? (
                <div className="chat-bubble agent-bubble" style={{ cursor: 'pointer' }} onClick={() => onSelectSession(m.sessionId!, m.tabId)}>
                  <Markdown>{m.content}</Markdown>
                </div>
              ) : (
                <div className="chat-bubble agent-bubble">
                  <Markdown components={{ a: ({ href, children }) => (
                    <a href={href} onClick={e => { e.preventDefault(); if (href) window.open(href, '_blank') }} target="_blank" rel="noopener">{children}</a>
                  ) }}>{m.content || (m.streaming ? '' : '')}</Markdown>
                {m.streaming && !m.content && <span className="typing-dots"><span/><span/><span/></span>}
                </div>
              )
            ) : (
              <div className="chat-bubble user-bubble">
                {m.content}
                {m.queued && (
                  <button className="queued-cancel" onClick={() => cancelMessage(m.id)} title="Cancel">✕</button>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="overwatch-input">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? 'Queued — will send next...' : 'Ask Overwatch anything...'}
          rows={1}
        />
        {isStreaming ? (
          <button className="btn-stop" onClick={() => { window.overwatch.orchestrator.cancel(''); setIsStreaming(false); setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m)) }} title="Stop">■</button>
        ) : (
          <button className="btn-send" onClick={send} disabled={!input.trim()}>↑</button>
        )}
      </div>
    </div>
  )
}
