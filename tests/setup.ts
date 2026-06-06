import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import type { Session } from '../src/shared/types'

// jsdom doesn't implement scrollIntoView or canvas
Element.prototype.scrollIntoView = vi.fn()

// Mock TerminalView since xterm.js requires a real DOM
vi.mock('../src/renderer/src/components/TerminalView', () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) => {
    const React = require('react')
    return React.createElement('div', { 'data-testid': `terminal-${sessionId}` }, 'Terminal mock')
  }
}))

const mockSessions: Session[] = []

const overwatch = {
  sessions: {
    list: vi.fn(async () => mockSessions),
    create: vi.fn(async (goal: string, dir: string): Promise<Session> => {
      const tabId = crypto.randomUUID()
      const session: Session = {
        id: crypto.randomUUID(),
        name: goal.slice(0, 30).replace(/\s+/g, '-').toLowerCase(),
        goal,
        workingDir: dir,
        state: 'running',
        tabs: [{ id: tabId, name: 'terminal', type: 'terminal', command: '/bin/zsh' }],
        activeTabId: tabId,
        createdAt: Date.now(),
        lastActivityAt: Date.now()
      }
      mockSessions.push(session)
      return session
    }),
    kill: vi.fn(async (id: string) => {
      const idx = mockSessions.findIndex(s => s.id === id)
      if (idx >= 0) mockSessions.splice(idx, 1)
    }),
    restart: vi.fn(async (id: string): Promise<Session> => {
      const session = mockSessions.find(s => s.id === id)!
      session.state = 'running'
      return session
    }),
    tell: vi.fn(async () => {}),
    pickDir: vi.fn(async () => '/tmp/picked')
  },
  tabs: {
    add: vi.fn(async () => ({ id: crypto.randomUUID(), name: 'terminal', type: 'terminal', command: '/bin/zsh' })),
    close: vi.fn(async () => {})
  },
  terminal: {
    spawn: vi.fn(async () => {}),
    write: vi.fn(),
    onData: vi.fn(() => () => {})
  },
  orchestrator: {
    onEvent: vi.fn()
  }
}

Object.defineProperty(window, 'overwatch', { value: overwatch, writable: true })

export { overwatch, mockSessions }
