/**
 * Reproduces the bug: status never leaves "red" after accepting a permission prompt.
 *
 * Root cause:
 *   When the user accepts in Claude Code's interactive TUI, the terminal redraws
 *   and echoes the selected option (e.g. "❯ Yes"). That new output contains the
 *   same approval pattern, so the detector keeps returning approval=true — even
 *   after the buffer is cleared — and the session state never transitions back to
 *   "working".
 *
 * Correct fix:
 *   Unblock the session immediately on terminal:write, because user input is
 *   unambiguous intent to accept. Do not rely on outgoing output analysis alone.
 */

import { describe, it, expect } from 'vitest'
import { RingBuffer, ApprovalDetector } from '../src/main/stuck-detector'

// ---- helpers mirroring onTabActivity ----------------------------------------

function stripAnsi(data: string): string {
  return data
    .replace(/\x1b\[[?!>]?[0-9;]*[a-zA-Z~]/g, '')
    .replace(/\x1b[()][0-9A-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

interface SimSession {
  state: 'working' | 'blocked' | 'done'
  blockedReason?: 'approval' | 'idle'
}

const detector = new ApprovalDetector()

/**
 * Simulates what onTabActivity does when new PTY data arrives.
 * `clearBeforePush` toggles the buffer-clear-on-approval fix.
 */
function onTabActivity(
  session: SimSession,
  buffer: RingBuffer,
  rawData: string,
  clearBeforePush: boolean
): void {
  const clean = stripAnsi(rawData)
  const lines = clean.split(/\r?\n|\r/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return

  if (clearBeforePush && session.state === 'blocked' && session.blockedReason === 'approval') {
    buffer.clear()
  }

  for (const line of lines) buffer.push(line)

  if (session.state === 'blocked') {
    const result = detector.analyze(buffer)
    if (!result.approval) {
      session.state = 'working'
      session.blockedReason = undefined
      buffer.clear()
    }
  }
}

/**
 * Simulates terminal:write unblocking — the fix that actually works.
 * Called whenever the user writes to the PTY (e.g. presses Enter/Y in the UI).
 */
function onTerminalWrite(session: SimSession, buffer: RingBuffer): void {
  if (session.state === 'blocked' && session.blockedReason === 'approval') {
    session.state = 'working'
    session.blockedReason = undefined
    buffer.clear()
  }
}

// ---- test helpers -----------------------------------------------------------

function blockSession(session: SimSession, buffer: RingBuffer): void {
  const prompt = ' web_search requires approval\r\n \x1b[1m❯\x1b[22m Yes, single permission\r\n   No (Tab to edit)\r\n'
  const clean = stripAnsi(prompt)
  for (const line of clean.split(/\r?\n|\r/).filter(l => l.trim())) buffer.push(line)
  expect(detector.analyze(buffer).approval).toBe(true)
  session.state = 'blocked'
  session.blockedReason = 'approval'
}

// ---- tests ------------------------------------------------------------------

describe('Bug reproduction: session stays blocked after user accepts', () => {
  it('BUG: without any fix, stale approval text in buffer blocks resume', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockSession(session, buf)

    // User accepts — Claude Code echoes "Yes" and continues.
    // Clean new output (no approval pattern): session SHOULD resume but does NOT.
    onTabActivity(session, buf, 'Searching the web...\r\nFound 5 results\r\n', false)

    // The stale "❯ Yes" line is still in the buffer → detector still fires → still blocked.
    expect(session.state).toBe('blocked')
  })

  it('BUG: buffer-clear-before-push alone is not enough when the TUI redraw echoes the prompt', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockSession(session, buf)

    // After the user presses Enter, Claude Code's TUI redraws and echoes the selection.
    // The new terminal chunk still contains "❯ Yes" as part of the screen update.
    const tuiRedrawAfterAccept =
      '\x1b[2K \x1b[1m❯\x1b[22m Yes, single permission\r\n' + // TUI redraws the chosen option
      '\x1b[0m\r\nSearching the web...\r\n'                    // then continues execution

    // With the buffer-clear fix in onTabActivity, we clear first, then push.
    // But the new chunk itself contains "❯ Yes" → still detected as approval.
    onTabActivity(session, buf, tuiRedrawAfterAccept, true /* clearBeforePush */)

    // Still blocked — the fix is insufficient.
    expect(session.state).toBe('blocked')
  })
})

describe('Fix: unblock on terminal:write (user input = intent to accept)', () => {
  it('immediately transitions to working the moment the user writes to the PTY', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockSession(session, buf)

    // User presses Enter in the terminal UI → terminal:write fires.
    onTerminalWrite(session, buf)

    expect(session.state).toBe('working')
    expect(session.blockedReason).toBeUndefined()
  })

  it('buffer is cleared on write so subsequent output analysis finds no stale prompt', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    blockSession(session, buf)
    onTerminalWrite(session, buf)

    // Even if the TUI redraw echoes "❯ Yes", onTabActivity now sees a working session,
    // so it goes through the "check working sessions for new approval" path.
    // That path correctly detects a new approval — but the session was already working,
    // so subsequent output is evaluated fresh, not against stale state.
    expect(buf.lines().length).toBe(0) // buffer cleared
    expect(session.state).toBe('working')
  })

  it('a real second approval after resuming is still detected', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    // First approval → user accepts → session resumes
    blockSession(session, buf)
    onTerminalWrite(session, buf)
    expect(session.state).toBe('working')

    // Agent immediately hits a second approval prompt
    const secondPrompt = ' file_write requires approval\r\n ❯ Yes\r\n   No\r\n'
    const clean = stripAnsi(secondPrompt)
    for (const line of clean.split(/\r?\n|\r/).filter(l => l.trim())) buf.push(line)

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true) // correctly detected again
  })

  it('write on a non-blocked session is a no-op', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'working' }

    onTerminalWrite(session, buf) // should not throw or change state
    expect(session.state).toBe('working')
  })

  it('write on an idle-blocked session does not unblock (only approval blocks respond to write)', () => {
    const buf = new RingBuffer(100)
    const session: SimSession = { state: 'blocked', blockedReason: 'idle' }

    onTerminalWrite(session, buf)
    // Idle blocks require explicit action, not just any keypress
    expect(session.state).toBe('blocked')
    expect(session.blockedReason).toBe('idle')
  })
})
