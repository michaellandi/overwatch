import { describe, it, expect } from 'vitest'
import { RingBuffer, ApprovalDetector } from '../src/main/stuck-detector'

describe('RingBuffer', () => {
  it('stores and retrieves lines in order', () => {
    const buf = new RingBuffer(5)
    buf.push('a')
    buf.push('b')
    buf.push('c')
    expect(buf.lines()).toEqual(['a', 'b', 'c'])
  })

  it('wraps around when full', () => {
    const buf = new RingBuffer(3)
    buf.push('a')
    buf.push('b')
    buf.push('c')
    buf.push('d')
    expect(buf.lines()).toEqual(['b', 'c', 'd'])
  })

  it('last(n) returns the most recent n lines', () => {
    const buf = new RingBuffer(10)
    for (let i = 0; i < 7; i++) buf.push(`line-${i}`)
    expect(buf.last(3)).toEqual(['line-4', 'line-5', 'line-6'])
  })

  it('last(n) returns all lines when n exceeds buffer size', () => {
    const buf = new RingBuffer(10)
    buf.push('a')
    buf.push('b')
    expect(buf.last(100)).toEqual(['a', 'b'])
  })

  it('clear resets the buffer', () => {
    const buf = new RingBuffer(5)
    buf.push('a')
    buf.push('b')
    buf.clear()
    expect(buf.lines()).toEqual([])
  })

  it('handles exact capacity fill', () => {
    const buf = new RingBuffer(3)
    buf.push('a')
    buf.push('b')
    buf.push('c')
    expect(buf.lines()).toEqual(['a', 'b', 'c'])
  })

  it('handles multiple wraps', () => {
    const buf = new RingBuffer(3)
    for (let i = 0; i < 10; i++) buf.push(`${i}`)
    expect(buf.lines()).toEqual(['7', '8', '9'])
  })
})

describe('ApprovalDetector', () => {
  describe('returns no approval for normal output', () => {
    it('regular build output', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('Compiling...')
      buf.push('src/index.ts compiled')
      buf.push('Done in 1.2s')
      expect(detector.analyze(buf)).toEqual({ approval: false })
    })

    it('error output (not an approval prompt)', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('Error: cannot find module')
      buf.push('BUILD FAILED')
      buf.push('Error: test failed')
      expect(detector.analyze(buf)).toEqual({ approval: false })
    })

    it('repeated errors (agent still working)', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      for (let i = 0; i < 10; i++) buf.push('BUILD FAILED')
      expect(detector.analyze(buf)).toEqual({ approval: false })
    })

    it('looping output (agent still working)', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      for (let i = 0; i < 5; i++) {
        buf.push('step 1')
        buf.push('step 2')
      }
      expect(detector.analyze(buf)).toEqual({ approval: false })
    })

    it('empty buffer', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      expect(detector.analyze(buf)).toEqual({ approval: false })
    })
  })

  describe('detects Claude Code approval prompts', () => {
    it('❯ alone does NOT trigger (Claude TUI chrome / cursor — too many false positives)', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('Done with the refactoring.')
      buf.push('❯')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(false)
    })

    it('> prompt (not detected alone — too many false positives)', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('Finished.')
      buf.push('  > ')
      const result = detector.analyze(buf)
      // Bare > is no longer matched to avoid false positives
      expect(result.approval).toBe(false)
    })

    it('y/n confirmation', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('Apply these changes? (y/n)')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(true)
    })

    it('[Y/n] confirmation', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('Continue? [Y/n]')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(true)
    })

    it('Do you want to prompt', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('Do you want to proceed with the changes?')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(true)
    })

    it('Press enter to continue', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('Press enter to continue')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(true)
    })
  })

  describe('does NOT false-positive on Kiro thinking/processing output', () => {
    it('You: in conversation history while Kiro is thinking', () => {
      // Kiro displays "You:" when rendering conversation context during processing —
      // this must not be mistaken for an approval prompt.
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('You: fix the login bug')
      buf.push('Kiro: Thinking...')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(false)
    })

    it('⏎ symbol in Kiro UI chrome while processing', () => {
      // Kiro shows ⏎ as a general keyboard hint in its UI, not only on approval screens.
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('Analyzing codebase...')
      buf.push('  ⏎  to submit')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(false)
    })
  })

  describe('detects Kiro approval prompts', () => {
    it('requires approval', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('This action requires approval before continuing')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(true)
    })

    it('❯ Yes/No/Trust selection', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('❯ Yes')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(true)
    })

    it('Tab to edit', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('Tab to edit')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(true)
    })
  })

  describe('detects generic shell prompts', () => {
    it('$ prompt (no longer matched to avoid false positives)', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('user@host:~/project$ ')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(false)
    })

    it('% prompt (no longer matched to avoid false positives)', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('user@host ~/project% ')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(false)
    })
  })

  describe('only checks the last 30 lines', () => {
    it('does not trigger on old prompts buried in output', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('You:')  // old prompt
      // Push enough lines to push it out of the 30-line window
      for (let i = 0; i < 31; i++) buf.push(`output line ${i}`)
      const result = detector.analyze(buf)
      expect(result.approval).toBe(false)
    })

    it('triggers when prompt is within last 30 lines', () => {
      const detector = new ApprovalDetector()
      const buf = new RingBuffer(100)
      buf.push('lots of output here')
      buf.push('Apply these changes? (y/n)')
      // A few spinner frames after
      for (let i = 0; i < 20; i++) buf.push(`◔ WebSearch...`)
      const result = detector.analyze(buf)
      expect(result.approval).toBe(true)
    })
  })

  describe('custom patterns', () => {
    it('accepts custom regex patterns', () => {
      const detector = new ApprovalDetector([/CUSTOM_PROMPT/])
      const buf = new RingBuffer(100)
      buf.push('CUSTOM_PROMPT')
      const result = detector.analyze(buf)
      expect(result.approval).toBe(true)
    })

    it('custom patterns override defaults', () => {
      const detector = new ApprovalDetector([/CUSTOM_PROMPT/])
      const buf = new RingBuffer(100)
      buf.push('You:')  // would normally trigger
      const result = detector.analyze(buf)
      expect(result.approval).toBe(false)
    })
  })
})
