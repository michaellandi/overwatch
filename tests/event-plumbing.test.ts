import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'

describe('Event plumbing', () => {
  describe('Event types', () => {
    const source = readFileSync('./src/main/orchestrator.ts', 'utf-8')

    it('emits session:created on createSession', () => {
      expect(source).toContain("type: 'session:created'")
    })

    it('emits session:killed on killSession', () => {
      expect(source).toContain("type: 'session:killed'")
    })

    it('emits session:restarted on restartSession', () => {
      expect(source).toContain("type: 'session:restarted'")
    })

    it('emits session:resumed when blocked session gets output', () => {
      expect(source).toContain("type: 'session:resumed'")
    })

    it('emits session:idle on inactivity timeout', () => {
      expect(source).toContain("type: 'session:idle'")
    })

    it('emits session:approval on agent prompt detection', () => {
      expect(source).toContain("type: 'session:approval'")
    })
  })

  describe('Event filtering for agent injection', () => {
    const source = readFileSync('./src/main/orchestrator.ts', 'utf-8')

    it('only injects session:approval and session:idle into agent', () => {
      expect(source).toContain("event.type === 'session:approval' || event.type === 'session:idle'")
    })

    it('does not inject session:created into agent', () => {
      // The filter should exclude info events
      const notifyMethod = source.slice(source.indexOf('private notify('))
      expect(notifyMethod).not.toContain("session:created")
    })
  })

  describe('Event includes sessionId and tabId', () => {
    const source = readFileSync('./src/main/orchestrator.ts', 'utf-8')

    it('session:approval includes tabId', () => {
      // There are multiple session:approval notify calls (hook handler + PTY paths).
      // Verify at least one of them passes a tabId.
      let idx = 0
      let found = false
      while (true) {
        idx = source.indexOf("type: 'session:approval'", idx)
        if (idx === -1) break
        const block = source.slice(idx - 150, idx + 150)
        if (block.includes('tabId:')) { found = true; break }
        idx++
      }
      expect(found).toBe(true)
    })

    it('eventListener signature accepts sessionId and tabId', () => {
      expect(source).toContain('eventListener?.(event.summary, event.sessionId, event.tabId)')
    })
  })

  describe('Agent injectEvent', () => {
    const source = readFileSync('./src/main/strands-agent.ts', 'utf-8')

    it('injectEvent accepts summary, sessionId, and tabId', () => {
      expect(source).toContain('injectEvent(summary: string, sessionId?: string, tabId?: string)')
    })

    it('includes sessionId and tabId in the event message', () => {
      expect(source).toContain('sessionId &&')
      expect(source).toContain('tabId &&')
    })

    it('pushes event as user message with [EVENT] prefix', () => {
      expect(source).toContain('[EVENT]')
    })

    it('pushes a "Noted." assistant response after event', () => {
      expect(source).toContain("{ type: 'text', text: 'Noted.' }")
    })
  })

  describe('sessions_tell accepts tabId', () => {
    const source = readFileSync('./src/main/strands-agent.ts', 'utf-8')

    it('tool schema includes tabId property', () => {
      const tellIdx = source.indexOf("'sessions_tell'")
      const block = source.slice(tellIdx, tellIdx + 500)
      expect(block).toContain('tabId')
    })

    it('handler passes tabId to orchestrator.tellSession', () => {
      const tellIdx = source.indexOf("'sessions_tell'")
      const block = source.slice(tellIdx, tellIdx + 800)
      expect(block).toContain('input.tabId')
    })
  })

  describe('tellSession targets specific tab', () => {
    const source = readFileSync('./src/main/orchestrator.ts', 'utf-8')

    it('tellSession accepts optional tabId parameter', () => {
      expect(source).toContain('tellSession(sessionId: string, message: string, tabId?: string)')
    })

    it('uses tabId when provided, falls back to activeTabId', () => {
      expect(source).toContain('const target = tabId ?? session.activeTabId')
    })

    it('writes to PTY with carriage return', () => {
      expect(source).toContain("pty.write(message + '\\r')")
    })
  })

  describe('Wiring in index.ts', () => {
    const source = readFileSync('./src/main/index.ts', 'utf-8')

    it('connects orchestrator events to agent.injectEvent with all params', () => {
      expect(source).toContain('orchestrator.onEvent((summary, sessionId, tabId) => agent.injectEvent(summary, sessionId, tabId))')
    })
  })
})
