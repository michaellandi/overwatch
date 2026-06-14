import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'

// ── Pure logic: sound guard ──────────────────────────────────────────────────

function soundEnabled(storage: Record<string, string>): boolean {
  const val = storage['ow-sound-enabled'] ?? null
  return val !== 'false'
}

describe('Sound setting — guard logic', () => {
  it('plays by default when key is absent', () => {
    expect(soundEnabled({})).toBe(true)
  })

  it('plays when explicitly set to true', () => {
    expect(soundEnabled({ 'ow-sound-enabled': 'true' })).toBe(true)
  })

  it('does not play when set to false', () => {
    expect(soundEnabled({ 'ow-sound-enabled': 'false' })).toBe(false)
  })

  it('plays when set to an unexpected value (safe default)', () => {
    expect(soundEnabled({ 'ow-sound-enabled': 'yes' })).toBe(true)
  })
})

// ── Source: OverwatchPane uses the guard correctly ────────────────────────────

describe('OverwatchPane — sound guard in source', () => {
  const source = readFileSync('./src/renderer/src/components/OverwatchPane.tsx', 'utf-8')

  it('only plays on session:approval and session:idle events', () => {
    const guardIdx = source.indexOf("'ow-sound-enabled'")
    const block = source.slice(guardIdx - 200, guardIdx + 50)
    expect(block).toContain('session:approval')
    expect(block).toContain('session:idle')
  })

  it("checks !== 'false' (plays by default when key is absent)", () => {
    expect(source).toContain("localStorage.getItem('ow-sound-enabled') !== 'false'")
  })
})

// ── Source: listener cleanup is wired up ─────────────────────────────────────

describe('OverwatchPane — listener cleanup', () => {
  const source = readFileSync('./src/renderer/src/components/OverwatchPane.tsx', 'utf-8')

  it('captures return value of onEvent', () => {
    expect(source).toContain('const unsubEvent = window.overwatch.orchestrator.onEvent(')
  })

  it('captures return value of onChatStream', () => {
    expect(source).toContain('const unsubChatStream = window.overwatch.orchestrator.onChatStream(')
  })

  it('captures return value of onChatDone', () => {
    expect(source).toContain('const unsubChatDone = window.overwatch.orchestrator.onChatDone(')
  })

  it('captures return value of onToolCall', () => {
    expect(source).toContain('const unsubToolCall = window.overwatch.orchestrator.onToolCall(')
  })

  it('captures return value of onToolResult', () => {
    expect(source).toContain('const unsubToolResult = window.overwatch.orchestrator.onToolResult(')
  })

  it('calls all unsub functions in the effect cleanup', () => {
    const returnIdx = source.indexOf('return () => {')
    const cleanup = source.slice(returnIdx, returnIdx + 200)
    expect(cleanup).toContain('unsubEvent()')
    expect(cleanup).toContain('unsubChatStream()')
    expect(cleanup).toContain('unsubChatDone()')
    expect(cleanup).toContain('unsubToolCall()')
    expect(cleanup).toContain('unsubToolResult()')
  })
})

// ── Source: preload returns cleanup functions ─────────────────────────────────

describe('Preload — orchestrator listeners return cleanup', () => {
  const source = readFileSync('./src/preload/index.ts', 'utf-8')

  it.each(['orchestrator:event', 'overwatch:chat-stream', 'overwatch:chat-done', 'overwatch:tool-call', 'overwatch:tool-result'])(
    'registers and returns removeListener for %s',
    (channel) => {
      const idx = source.indexOf(`'${channel}'`)
      const block = source.slice(idx - 100, idx + 150)
      expect(block).toContain('ipcRenderer.on(')
      expect(block).toContain('ipcRenderer.removeListener(')
    }
  )
})

// ── Source: Settings uses controlled checkbox ─────────────────────────────────

describe('Settings — controlled sound checkbox', () => {
  const source = readFileSync('./src/renderer/src/components/Settings.tsx', 'utf-8')

  it('uses checked= (controlled) not defaultChecked= (uncontrolled)', () => {
    expect(source).toContain('checked={soundEnabled}')
    expect(source).not.toContain('defaultChecked')
  })

  it('syncs soundEnabled state from localStorage whenever the panel opens', () => {
    const effectIdx = source.indexOf('if (open)')
    const block = source.slice(effectIdx, effectIdx + 200)
    expect(block).toContain("setSoundEnabled(localStorage.getItem('ow-sound-enabled') !== 'false')")
  })

  it('saves to localStorage when the checkbox changes', () => {
    expect(source).toContain("localStorage.setItem('ow-sound-enabled'")
  })

  it('updates soundEnabled React state when the checkbox changes', () => {
    expect(source).toContain('setSoundEnabled(e.target.checked)')
  })
})
