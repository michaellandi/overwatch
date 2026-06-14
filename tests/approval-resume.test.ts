/**
 * Tests for approval-blocked session resume behaviour.
 *
 * The core problem: Claude Code's TUI redraws the selected menu option
 * ("❯ 1. Yes") immediately after the user accepts, which re-triggers the
 * approval detector.  A time-based cooldown doesn't help because the
 * repaint lines sit in the ring buffer and re-block the session once the
 * cooldown expires.
 *
 * Correct fix: needsCleanOutput flag.  After unblocking, every incoming
 * chunk re-clears the buffer before being pushed, and detection is skipped
 * until the first chunk that contains no approval pattern.  This flushes
 * the repaint lines without any timing dependency.
 */

import { describe, it, expect } from 'vitest'
import { RingBuffer, ApprovalDetector } from '../src/main/stuck-detector'

// ---- simulation helpers -------------------------------------------------------

function stripAnsi(data: string): string {
  return data
    .replace(/\x1b\[[?!>]?[0-9;]*[a-zA-Z~]/g, '')
    .replace(/\x1b[()][0-9A-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

interface SimSession {
  state: 'working' | 'blocked' | 'done'
  blockedReason?: 'approval' | 'idle'
  needsCleanOutput?: boolean
}

const detector = new ApprovalDetector()

function onTabActivity(session: SimSession, buffer: RingBuffer, rawData: string): void {
  const clean = stripAnsi(rawData)
  const lines = clean.split(/\r?\n|\r/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return

  // Path 1a: clear for approval-blocked sessions before re-evaluating
  if (session.state === 'blocked' && session.blockedReason === 'approval') {
    buffer.clear()
  }

  // Path 1b: while waiting for first clean post-acceptance output, always
  // re-clear the buffer so TUI repaint lines never outlive a single chunk
  if (session.state === 'working' && session.needsCleanOutput) {
    buffer.clear()
  }

  for (const line of lines) buffer.push(line)

  // Path 3: working → check if approval appeared → block
  if (session.state === 'working') {
    if (session.needsCleanOutput) {
      // Clear the flag once the output is genuinely clean
      if (!detector.analyze(buffer).approval) {
        session.needsCleanOutput = false
      }
      return // never block while flag is set
    }
    if (detector.analyze(buffer).approval) {
      session.state = 'blocked'
      session.blockedReason = 'approval'
    }
  }
}

function onTerminalWrite(session: SimSession, buffer: RingBuffer): void {
  if (session.state === 'blocked' && session.blockedReason === 'approval') {
    session.state = 'working'
    session.blockedReason = undefined
    session.needsCleanOutput = true
    buffer.clear()
  }
}

function simulateCheckHealth(session: SimSession, buffer: RingBuffer): void {
  if (session.state !== 'working') return
  if (session.needsCleanOutput) return // still waiting for clean output
  if (detector.analyze(buffer).approval) {
    session.state = 'blocked'
    session.blockedReason = 'approval'
  }
}

// ---- shared test data ---------------------------------------------------------

const CLAUDE_PROMPT =
  ' Do you want to proceed?\r\n' +
  ' \x1b[1m❯\x1b[22m 1. Yes\r\n' +
  "   2. Yes, and don't ask again for Web Search\r\n" +
  '   3. No\r\n'

const TUI_REDRAW_AFTER_ACCEPT =
  ' \x1b[1m❯\x1b[22m 1. Yes\r\n' +       // selected item still rendered during redraw
  "   2. Yes, and don't ask again\r\n" +
  '   3. No\r\n' +
  'Searching the web for: kiro 2026\r\n'  // Claude continues but outputs little

function blockWithClaudePrompt(session: SimSession, buf: RingBuffer): void {
  onTabActivity(session, buf, CLAUDE_PROMPT)
  expect(session.state).toBe('blocked')
}

// ---- bug reproductions (assert broken behaviour so regressions are obvious) ---

describe('Bug: original stale-buffer issues', () => {
  it('stale approval lines in buffer keep detector returning true on clean output', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockWithClaudePrompt(session, buf)

    // Without any buffer management, pushing clean lines on top of stale ones
    // doesn't help — the detector still sees the old approval lines.
    const cleanOutput = 'Searching the web...\r\nFound 5 results\r\n'
    for (const line of stripAnsi(cleanOutput).split(/\r?\n|\r/).filter(l => l.trim())) {
      buf.push(line)
    }
    expect(detector.analyze(buf).approval).toBe(true) // stale lines still win
  })

  it('buffer-clear-before-push alone fails when the TUI redraw itself contains the pattern', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockWithClaudePrompt(session, buf)

    // Session is blocked → Path 1a clears buffer → new chunk pushed
    // But the new chunk is the TUI redraw which still contains "❯ 1. Yes"
    onTabActivity(session, buf, TUI_REDRAW_AFTER_ACCEPT)
    expect(session.state).toBe('blocked') // still blocked — redraw re-triggered it
  })
})

// ---- fix verification ---------------------------------------------------------

describe('Fix: needsCleanOutput flag prevents repaint from re-blocking', () => {
  it('terminal:write immediately unblocks and sets the flag', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockWithClaudePrompt(session, buf)
    onTerminalWrite(session, buf)

    expect(session.state).toBe('working')
    expect(session.blockedReason).toBeUndefined()
    expect(session.needsCleanOutput).toBe(true)
  })

  it('TUI redraw with "❯ 1. Yes" does not re-block while flag is set', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockWithClaudePrompt(session, buf)
    onTerminalWrite(session, buf)
    onTabActivity(session, buf, TUI_REDRAW_AFTER_ACCEPT)

    expect(session.state).toBe('working')
    expect(session.needsCleanOutput).toBe(true) // flag still set — redraw wasn't clean
  })

  it('checkHealth does not re-block while flag is set (fixes the timer-based bug)', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockWithClaudePrompt(session, buf)
    onTerminalWrite(session, buf)
    onTabActivity(session, buf, TUI_REDRAW_AFTER_ACCEPT)

    // checkHealth fires (no matter how long after) — flag is still set
    simulateCheckHealth(session, buf)
    expect(session.state).toBe('working') // FIX: not re-blocked
  })

  it('flag is cleared by the first genuinely clean output chunk', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockWithClaudePrompt(session, buf)
    onTerminalWrite(session, buf)
    onTabActivity(session, buf, TUI_REDRAW_AFTER_ACCEPT)
    expect(session.needsCleanOutput).toBe(true)

    // Claude finishes the tool and outputs results
    onTabActivity(session, buf, 'Search complete: 5 results found\r\n')
    expect(session.needsCleanOutput).toBe(false) // flag cleared
    expect(session.state).toBe('working')
  })

  it('real second approval after clean output is detected normally', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockWithClaudePrompt(session, buf)
    onTerminalWrite(session, buf)
    onTabActivity(session, buf, TUI_REDRAW_AFTER_ACCEPT)
    onTabActivity(session, buf, 'Search complete: 5 results found\r\n')
    expect(session.needsCleanOutput).toBe(false)

    // Agent hits another approval prompt
    onTabActivity(session, buf, ' file_write requires approval\r\n ❯ Yes\r\n   No\r\n')
    expect(session.state).toBe('blocked')
  })

  it('multiple TUI redraw chunks are all absorbed before clean output clears the flag', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockWithClaudePrompt(session, buf)
    onTerminalWrite(session, buf)

    // Several repaint chunks arrive (cursor blink, scroll, etc.)
    onTabActivity(session, buf, ' \x1b[1m❯\x1b[22m 1. Yes\r\n   3. No\r\n')
    onTabActivity(session, buf, ' \x1b[1m❯\x1b[22m 1. Yes\r\n   3. No\r\n')
    onTabActivity(session, buf, ' \x1b[1m❯\x1b[22m 1. Yes\r\n   3. No\r\n')
    expect(session.state).toBe('working')
    expect(session.needsCleanOutput).toBe(true) // still waiting

    onTabActivity(session, buf, 'Running tool...\r\n')
    expect(session.needsCleanOutput).toBe(false)
    expect(session.state).toBe('working')
  })
})

describe('Bug: stale session:approval notification re-blocks the renderer after resume', () => {
  // The orchestrator fires session:approval inside a summarizeBlocked().then() callback.
  // That async call takes 1–3 seconds. The user may have already accepted (session:resumed
  // sent) before the .then() resolves. When it does, the stale session:approval fires and
  // the renderer flips back to blocked even though the orchestrator is working fine.

  function simulateRendererState(events: Array<{ type: string }>): 'working' | 'blocked' {
    let state: 'working' | 'blocked' = 'working'
    for (const e of events) {
      if (e.type === 'session:approval' || e.type === 'session:idle') state = 'blocked'
      if (e.type === 'session:resumed') state = 'working'
    }
    return state
  }

  it('BUG: delayed session:approval (from async summarize) overrides session:resumed in renderer', () => {
    // Events as the renderer receives them:
    const rendererEvents: Array<{ type: string }> = []

    // t=0: approval detected synchronously → session:approval queued
    rendererEvents.push({ type: 'session:approval' })   // immediate (sync part of notify fires first,
                                                         // but the CONTENT arrives after summarize)
    // t=0.5s: user accepts → session:resumed
    rendererEvents.push({ type: 'session:resumed' })

    // Renderer is now working ✓ — but then:
    // t=1.5s: summarizeBlocked().then() resolves → fires session:approval again
    rendererEvents.push({ type: 'session:approval' })   // stale notification

    expect(simulateRendererState(rendererEvents)).toBe('blocked') // BUG: back to red
  })

  it('FIX: if session:approval is suppressed when session is no longer blocked, renderer stays working', () => {
    const rendererEvents: Array<{ type: string }> = []

    rendererEvents.push({ type: 'session:approval' })  // initial detection
    rendererEvents.push({ type: 'session:resumed' })   // user accepted

    // summarizeBlocked resolves, but the orchestrator checks session.state before notifying.
    // Session is now 'working', so session:approval is NOT sent.
    // (no third event)

    expect(simulateRendererState(rendererEvents)).toBe('working') // FIX: stays green
  })
})

describe('Bug: spinner output causes false auto-resume while approval dialog is still visible', () => {
  // When the session is blocked and Path 1a clears the buffer, any subsequent
  // output chunk (e.g. Claude's spinner "◔ Thinking...") that contains no
  // approval pattern causes Path 2 to auto-resume the session — even though
  // the approval dialog is still rendered in the terminal.
  // The guard in summarizeBlocked().then() then correctly suppresses the stale
  // session:approval, leaving the session permanently "working" with no red badge.

  const SPINNER_CHUNK = '\x1b[38;2;95;215;255m◔\x1b[39m \x1b[38;2;128;128;128mThinking...\x1b[39m'

  it('BUG: spinner output after detection falsely auto-resumes a blocked session', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockWithClaudePrompt(session, buf)
    expect(session.state).toBe('blocked')

    // Spinner arrives while approval dialog still visible — Path 1a clears
    // the buffer, then Path 2 sees no approval in the one spinner line.
    onTabActivity(session, buf, SPINNER_CHUNK)

    // BUG: session auto-resumed even though Claude still shows the dialog
    expect(session.state).toBe('blocked') // should stay blocked — currently FAILS
  })

  it('FIX: spinner output does not resume a blocked session', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockWithClaudePrompt(session, buf)

    // Multiple spinner chunks, none of which should clear the blocked state
    onTabActivity(session, buf, SPINNER_CHUNK)
    onTabActivity(session, buf, SPINNER_CHUNK)
    onTabActivity(session, buf, SPINNER_CHUNK)

    expect(session.state).toBe('blocked')
    expect(session.blockedReason).toBe('approval')
  })

  it('FIX: session still resumes correctly via terminal:write after fix', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockWithClaudePrompt(session, buf)
    onTabActivity(session, buf, SPINNER_CHUNK) // should not resume

    expect(session.state).toBe('blocked') // still blocked

    onTerminalWrite(session, buf) // user accepts
    expect(session.state).toBe('working')
    expect(session.needsCleanOutput).toBe(true)
  })
})

describe('Edge cases', () => {
  it('write on a non-blocked session is a no-op', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }
    onTerminalWrite(session, buf)
    expect(session.state).toBe('working')
    expect(session.needsCleanOutput).toBeUndefined()
  })

  it('write on an idle-blocked session does not unblock', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'blocked', blockedReason: 'idle' }
    onTerminalWrite(session, buf)
    expect(session.state).toBe('blocked')
    expect(session.blockedReason).toBe('idle')
  })

  it('checkHealth on idle-blocked session is a no-op', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'blocked', blockedReason: 'idle' }
    simulateCheckHealth(session, buf)
    expect(session.state).toBe('blocked')
  })
})
