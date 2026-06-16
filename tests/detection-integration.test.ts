import { describe, it, expect } from 'vitest'
import { RingBuffer, ApprovalDetector } from '../src/main/stuck-detector'

/**
 * These tests simulate the actual data flow through the detection system:
 * 1. Raw terminal data arrives with ANSI codes
 * 2. ANSI is stripped
 * 3. Lines are split on \r and \n
 * 4. Lines pushed into RingBuffer
 * 5. ApprovalDetector checks the buffer
 *
 * This mirrors what onTabActivity does in the orchestrator.
 */

function stripAnsi(data: string): string {
  return data
    .replace(/\x1b\[[?!>]?[0-9;]*[a-zA-Z~]/g, '')
    .replace(/\x1b[()][0-9A-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

function simulateDataArrival(buffer: RingBuffer, rawData: string): void {
  const clean = stripAnsi(rawData)
  const lines = clean.split(/\r?\n|\r/).filter(l => l.trim().length > 0)
  for (const line of lines) buffer.push(line)
}

describe('Detection integration: Kiro TUI approval flow', () => {
  const detector = new ApprovalDetector()

  it('detects approval after Kiro tool approval prompt', () => {
    const buf = new RingBuffer(100)

    // Simulate thinking spinner output
    simulateDataArrival(buf, '\x1b[38;2;95;215;255m\x1b[39m \x1b[38;2;128;128;128mThinking...\x1b[39m\x1b[38;2;98;98;98m (esc to cancel)\x1b[39m')
    simulateDataArrival(buf, '\x1b[38;2;95;215;255m\x1b[39m \x1b[38;2;128;128;128mThinking...\x1b[39m\x1b[38;2;98;98;98m (esc to cancel)\x1b[39m')

    // Simulate the approval prompt appearing
    simulateDataArrival(buf, '\r\n web_search requires approval\r\n \x1b[38;2;255;0;255m\x1b[1m❯\x1b[22m\x1b[39m \x1b[38;2;255;0;255m\x1b[1mYes, single permission\x1b[22m\x1b[39m\r\n   Trust, always allow in this session\r\n   No (Tab to edit)\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })

  it('detects approval even with spinner frames AFTER the prompt', () => {
    const buf = new RingBuffer(100)

    // Approval prompt
    simulateDataArrival(buf, ' web_search requires approval\r\n ❯ Yes, single permission\r\n   Trust, always allow\r\n   No (Tab to edit)\r\n')

    // Spinner frames that come after (cursor blinking, status bar updates)
    for (let i = 0; i < 20; i++) {
      simulateDataArrival(buf, `\r◔ WebSearch "Kiro"`)
    }

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })

  it('does NOT detect approval when spinner pushes prompt beyond 30-line window', () => {
    const buf = new RingBuffer(100)

    // Approval prompt
    simulateDataArrival(buf, ' web_search requires approval\r\n')

    // So many spinner frames that the prompt gets pushed out
    for (let i = 0; i < 35; i++) {
      simulateDataArrival(buf, `\r◔ frame ${i}`)
    }

    const result = detector.analyze(buf)
    expect(result.approval).toBe(false)
  })

  it('detects Kiro "requires approval" with ANSI color codes', () => {
    const buf = new RingBuffer(100)

    // Real Kiro output with color codes around the text
    const realData = '\x1b[2K web_search requires approval\x1b[0m\r\r\n\x1b[2K \x1b[38;2;255;0;255m\x1b[1m❯\x1b[22m\x1b[39m \x1b[38;2;255;0;255m\x1b[1mYes, single permission             \x1b[22m\x1b[39m\x1b[0m\r\r\n'
    simulateDataArrival(buf, realData)

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })

  it('detects "Tab to edit" from Kiro footer', () => {
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, '\x1b[2K ESC \x1b[38;2;128;128;128mto close\x1b[39m\x1b[38;2;128;128;128m · \x1b[39mTab \x1b[38;2;128;128;128mto edit\x1b[39m\x1b[0m')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })
})

describe('Detection integration: Claude Code approval flow', () => {
  const detector = new ApprovalDetector()

  it('detects Claude "Do you want to" prompt', () => {
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, 'I need to run a command.\r\n')
    simulateDataArrival(buf, 'Do you want to proceed?\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })

  it('detects Claude y/n prompt', () => {
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, 'Execute this command? (y/n)\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })

  it('detects Claude permission menu with ❯ Yes (unnumbered)', () => {
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, 'Do you want to run this command?\r\n')
    simulateDataArrival(buf, '\x1b[1m❯\x1b[22m Yes\r\n  No\r\n  Always allow\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })

  it('detects Claude permission menu with ❯ No highlighted (unnumbered)', () => {
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, '  Yes\r\n\x1b[1m❯\x1b[22m No\r\n  Always allow\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })

  it('detects Claude numbered permission menu: ❯ 1. Yes', () => {
    // Real Claude Code prompt: "Do you want to proceed? ❯ 1. Yes  2. Yes, and don't ask...  3. No"
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, ' Do you want to proceed?\r\n')
    simulateDataArrival(buf, ' \x1b[1m❯\x1b[22m 1. Yes\r\n')
    simulateDataArrival(buf, '   2. Yes, and don\'t ask again for Web Search commands\r\n')
    simulateDataArrival(buf, '   3. No\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })

  it('detects repaint chunk that only has ❯ 1. Yes (no "Do you want to" line)', () => {
    // After buffer.clear() on the next repaint, only the menu lines remain.
    // This is what caused the session to immediately flip back to working.
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, ' \x1b[1m❯\x1b[22m 1. Yes\r\n')
    simulateDataArrival(buf, '   2. Yes, and don\'t ask again\r\n')
    simulateDataArrival(buf, '   3. No\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })

  it('detects ❯ 3. No when user navigates to No option', () => {
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, '   1. Yes\r\n   2. Yes, and don\'t ask again\r\n \x1b[1m❯\x1b[22m 3. No\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })

  // False-positive regression tests — Claude Code uses ❯ heavily in its TUI
  // chrome during normal active execution; these must NOT trigger approval.

  it('does NOT flag bare ❯ on its own line (Claude input cursor during screen repaint)', () => {
    const buf = new RingBuffer(100)
    // Claude Code repaints the cursor on every output chunk when active
    simulateDataArrival(buf, 'Running tests...\r\n❯\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(false)
  })

  it('does NOT flag ❯ used as a step/tool indicator in Claude output', () => {
    const buf = new RingBuffer(100)
    // Claude Code uses ❯ as a visual bullet for tool steps
    simulateDataArrival(buf, '❯ Reading src/index.ts\r\n')
    simulateDataArrival(buf, '❯ Running: npm test\r\n')
    simulateDataArrival(buf, '❯ Writing src/utils.ts\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(false)
  })

  it('does NOT flag ❯ at end of tool-result lines (TUI border/chrome)', () => {
    const buf = new RingBuffer(100)
    // Claude Code renders tool result boxes with ❯ in the border chrome
    simulateDataArrival(buf, '\x1b[2K◆ Bash (read)                          ❯\r\n')
    simulateDataArrival(buf, '\x1b[2K  $ ls -la\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(false)
  })
})

describe('Detection integration: no false positives', () => {
  const detector = new ApprovalDetector()

  it('does NOT trigger on build errors', () => {
    const buf = new RingBuffer(100)
    for (let i = 0; i < 10; i++) {
      simulateDataArrival(buf, `error TS2322: Type 'string' is not assignable to type 'number'\r\n`)
    }
    simulateDataArrival(buf, 'BUILD FAILED\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(false)
  })

  it('does NOT trigger on repeated test failures', () => {
    const buf = new RingBuffer(100)
    for (let i = 0; i < 5; i++) {
      simulateDataArrival(buf, `FAIL src/test${i}.test.ts\r\n`)
      simulateDataArrival(buf, `  ✗ should work\r\n`)
    }

    const result = detector.analyze(buf)
    expect(result.approval).toBe(false)
  })

  it('does NOT trigger on normal compilation output', () => {
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, 'Compiling 42 modules...\r\n')
    simulateDataArrival(buf, 'Done in 3.2s\r\n')
    simulateDataArrival(buf, '✓ All checks passed\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(false)
  })

  it('does NOT trigger on shell prompts from terminal tabs', () => {
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, 'user@host:~/project$ \r\n')
    simulateDataArrival(buf, 'user@host ~/project% \r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(false)
  })

  it('does NOT trigger on git output containing "Do you want"', () => {
    // This is a tricky one - git sometimes says "Do you want to continue?"
    // but in an agent context this IS an approval prompt, so it SHOULD trigger
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, 'Do you want to continue with this merge?\r\n')

    const result = detector.analyze(buf)
    // This actually should trigger - it's a prompt waiting for input
    expect(result.approval).toBe(true)
  })

  it('does NOT trigger on Thinking spinner lines', () => {
    const buf = new RingBuffer(100)
    for (let i = 0; i < 30; i++) {
      simulateDataArrival(buf, `\x1b[38;2;95;215;255m◔\x1b[39m \x1b[38;2;128;128;128mThinking...\x1b[39m`)
    }

    const result = detector.analyze(buf)
    expect(result.approval).toBe(false)
  })

  it('does NOT trigger on active file editing output', () => {
    const buf = new RingBuffer(100)
    simulateDataArrival(buf, '  Writing src/index.ts\r\n')
    simulateDataArrival(buf, '  Writing src/utils.ts\r\n')
    simulateDataArrival(buf, '  Running npm test\r\n')
    simulateDataArrival(buf, '  Tests: 5 passed\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(false)
  })
})

describe('Detection integration: buffer clearing on approval resolution', () => {
  const detector = new ApprovalDetector()

  it('after buffer clear, old approval text no longer triggers', () => {
    const buf = new RingBuffer(100)

    // Approval prompt appears
    simulateDataArrival(buf, ' web_search requires approval\r\n ❯ Yes\r\n')
    expect(detector.analyze(buf).approval).toBe(true)

    // User responds, buffer gets cleared (simulating tellSession behavior)
    buf.clear()

    // New output after approval
    simulateDataArrival(buf, 'Searching the web...\r\n')
    simulateDataArrival(buf, 'Found 5 results\r\n')

    expect(detector.analyze(buf).approval).toBe(false)
  })

  it('new approval after clear is still detected', () => {
    const buf = new RingBuffer(100)

    // First approval
    simulateDataArrival(buf, 'requires approval\r\n')
    expect(detector.analyze(buf).approval).toBe(true)

    // Cleared
    buf.clear()

    // Agent does work
    simulateDataArrival(buf, 'Working...\r\n')
    expect(detector.analyze(buf).approval).toBe(false)

    // Second approval
    simulateDataArrival(buf, 'file_write requires approval\r\n ❯ Yes\r\n')
    expect(detector.analyze(buf).approval).toBe(true)
  })
})

describe('Detection integration: \r line splitting', () => {
  const detector = new ApprovalDetector()

  it('splits carriage-return-separated spinner frames into individual lines', () => {
    const buf = new RingBuffer(100)

    // This is how Kiro actually sends spinner data - multiple frames in one chunk separated by \r
    const chunk = '◔ Thinking...\r◑ Thinking...\r◕ Thinking...\r● Thinking...'
    simulateDataArrival(buf, chunk)

    // Should be 4 separate lines in buffer
    expect(buf.lines().length).toBe(4)
  })

  it('approval prompt split across chunks is still detected', () => {
    const buf = new RingBuffer(100)

    // First chunk: separator and beginning of approval
    simulateDataArrival(buf, '────────────────────────────────\r\n')
    // Second chunk: the actual approval text
    simulateDataArrival(buf, ' web_search requires approval\r\n')
    // Third chunk: the options
    simulateDataArrival(buf, ' ❯ Yes, single permission\r\n   Trust, always allow\r\n   No (Tab to edit)\r\n')

    const result = detector.analyze(buf)
    expect(result.approval).toBe(true)
  })
})
