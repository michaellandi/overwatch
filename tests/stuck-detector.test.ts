import { describe, it, expect } from 'vitest'
import { RingBuffer, StuckDetector } from '../src/main/stuck-detector'

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

  it('clear resets the buffer', () => {
    const buf = new RingBuffer(5)
    buf.push('a')
    buf.push('b')
    buf.clear()
    expect(buf.lines()).toEqual([])
  })
})

describe('StuckDetector', () => {
  it('returns not stuck for normal output', () => {
    const detector = new StuckDetector()
    const buf = new RingBuffer(100)
    buf.push('Compiling...')
    buf.push('src/index.ts compiled')
    buf.push('Done in 1.2s')
    const result = detector.analyze(buf)
    expect(result.stuck).toBe(false)
    expect(result.waiting).toBeUndefined()
  })

  it('detects repeated build failures as blocked', () => {
    const detector = new StuckDetector()
    const buf = new RingBuffer(100)
    buf.push('Building...')
    buf.push('BUILD FAILED')
    buf.push('Retrying...')
    buf.push('BUILD FAILED')
    buf.push('Retrying...')
    buf.push('BUILD FAILED')
    const result = detector.analyze(buf)
    expect(result.stuck).toBe(true)
    expect(result.matchedPattern).toBe('build-failed')
    expect(result.matchCount).toBe(3)
  })

  it('detects repeated errors as blocked', () => {
    const detector = new StuckDetector()
    const buf = new RingBuffer(100)
    for (let i = 0; i < 5; i++) {
      buf.push(`Error: cannot find module 'foo-${i}'`)
    }
    const result = detector.analyze(buf)
    expect(result.stuck).toBe(true)
    expect(result.matchedPattern).toBe('error-repeated')
  })

  it('detects permission denied as blocked', () => {
    const detector = new StuckDetector()
    const buf = new RingBuffer(100)
    buf.push('EACCES: permission denied, open /etc/passwd')
    buf.push('EACCES: permission denied, open /etc/shadow')
    const result = detector.analyze(buf)
    expect(result.stuck).toBe(true)
    expect(result.matchedPattern).toBe('permission-denied')
  })

  it('detects output loop (exact repeat) as blocked', () => {
    const detector = new StuckDetector()
    const buf = new RingBuffer(100)
    // Same 4 lines repeating
    for (let round = 0; round < 2; round++) {
      buf.push('step 1')
      buf.push('step 2')
      buf.push('step 3')
      buf.push('step 4')
    }
    const result = detector.analyze(buf)
    expect(result.stuck).toBe(true)
    expect(result.matchedPattern).toBe('exact-repeat')
  })

  it('detects agent waiting for input (kiro prompt)', () => {
    const detector = new StuckDetector()
    const buf = new RingBuffer(100)
    buf.push('I finished the refactoring.')
    buf.push('You:')
    const result = detector.analyze(buf)
    expect(result.stuck).toBe(false)
    expect(result.waiting).toBe(true)
  })

  it('detects agent waiting for input (claude prompt)', () => {
    const detector = new StuckDetector()
    const buf = new RingBuffer(100)
    buf.push('Done. Anything else?')
    buf.push('  ❯ ')
    const result = detector.analyze(buf)
    expect(result.stuck).toBe(false)
    expect(result.waiting).toBe(true)
  })

  it('detects y/n confirmation prompt as waiting', () => {
    const detector = new StuckDetector()
    const buf = new RingBuffer(100)
    buf.push('Apply these changes? (y/n)')
    const result = detector.analyze(buf)
    expect(result.stuck).toBe(false)
    expect(result.waiting).toBe(true)
  })

  it('does not false-positive on normal error below threshold', () => {
    const detector = new StuckDetector()
    const buf = new RingBuffer(100)
    buf.push('Error: file not found')
    buf.push('Continuing...')
    buf.push('Build complete')
    const result = detector.analyze(buf)
    expect(result.stuck).toBe(false)
  })

  it('does not trigger on empty buffer', () => {
    const detector = new StuckDetector()
    const buf = new RingBuffer(100)
    const result = detector.analyze(buf)
    expect(result.stuck).toBe(false)
  })

  it('respects custom patterns and window size', () => {
    const detector = new StuckDetector(
      [{ name: 'timeout', regex: /TIMEOUT/, threshold: 2 }],
      10
    )
    const buf = new RingBuffer(100)
    buf.push('TIMEOUT on request 1')
    buf.push('TIMEOUT on request 2')
    const result = detector.analyze(buf)
    expect(result.stuck).toBe(true)
    expect(result.matchedPattern).toBe('timeout')
  })
})
