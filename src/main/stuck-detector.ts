/**
 * Fixed-size ring buffer that stores the last N lines of output per session.
 */
export class RingBuffer {
  private buf: string[]
  private pos = 0
  private full = false

  constructor(private capacity: number = 100) {
    this.buf = new Array(capacity)
  }

  push(line: string): void {
    this.buf[this.pos] = line
    this.pos = (this.pos + 1) % this.capacity
    if (this.pos === 0) this.full = true
  }

  /** Return all stored lines in order (oldest first). */
  lines(): string[] {
    if (!this.full) return this.buf.slice(0, this.pos)
    return [...this.buf.slice(this.pos), ...this.buf.slice(0, this.pos)]
  }

  /** Return the last N lines. */
  last(n: number): string[] {
    const all = this.lines()
    return all.slice(-n)
  }

  clear(): void {
    this.buf = new Array(this.capacity)
    this.pos = 0
    this.full = false
  }
}

export interface StuckPattern {
  name: string
  regex: RegExp
  threshold: number // how many matches within the window triggers stuck
}

const DEFAULT_PATTERNS: StuckPattern[] = [
  { name: 'build-failed', regex: /\b(BUILD FAILED|build failed|FAILED)\b/, threshold: 3 },
  { name: 'error-repeated', regex: /\b(error|Error|ERROR)\b.*/, threshold: 5 },
  { name: 'test-failed', regex: /\b(FAIL|test.*failed|Tests:\s+\d+ failed)\b/i, threshold: 3 },
  { name: 'permission-denied', regex: /permission denied|EACCES/i, threshold: 2 },
  { name: 'connection-refused', regex: /ECONNREFUSED|connection refused/i, threshold: 3 },
]

// Patterns that indicate an agent is waiting for user input (not stuck, just done)
const AGENT_IDLE_PATTERNS = [
  // Claude Code prompts
  /^\s*❯\s*$/,
  /^\s*>\s*$/,
  /\? \(y\/n\)/i,
  /\[Y\/n\]/,
  /Press enter to continue/i,
  /Do you want to/i,
  // Kiro prompts
  /^You:/,
  /^\s*⏎/,
  /requires approval/i,
  /❯\s*(Yes|No|Trust)/,
  /Tab to edit/,
  // Generic input prompts
  /\$ $/,
  /% $/,
]

export interface StuckResult {
  stuck: boolean
  waiting?: boolean // agent is waiting for user input
  reason?: string
  matchedPattern?: string
  matchCount?: number
}

/**
 * Analyzes session output to detect repeated error patterns.
 * Works alongside the idle-timeout detector in the orchestrator.
 */
export class StuckDetector {
  private patterns: StuckPattern[]
  private window: number // how many recent lines to check

  constructor(patterns?: StuckPattern[], window = 50) {
    this.patterns = patterns ?? DEFAULT_PATTERNS
    this.window = window
  }

  /** Check if the recent output shows a stuck pattern. */
  analyze(buffer: RingBuffer): StuckResult {
    const recent = buffer.last(this.window)
    if (recent.length === 0) return { stuck: false }

    // Check if agent is waiting for user input (last few lines match idle prompt)
    const tail = recent.slice(-3)
    for (const line of tail) {
      for (const pattern of AGENT_IDLE_PATTERNS) {
        if (pattern.test(line)) {
          return { stuck: false, waiting: true, reason: `Agent is waiting for input`, matchedPattern: 'agent-idle' }
        }
      }
    }

    for (const pattern of this.patterns) {
      const matches = recent.filter(line => pattern.regex.test(line))
      if (matches.length >= pattern.threshold) {
        return {
          stuck: true,
          reason: `Pattern "${pattern.name}" matched ${matches.length} times in last ${this.window} lines`,
          matchedPattern: pattern.name,
          matchCount: matches.length
        }
      }
    }

    // Check for exact repeated lines (same output repeating = loop)
    const lastLines = recent.slice(-10)
    if (lastLines.length >= 6) {
      const half = Math.floor(lastLines.length / 2)
      const firstHalf = lastLines.slice(0, half).join('\n')
      const secondHalf = lastLines.slice(half, half * 2).join('\n')
      if (firstHalf === secondHalf && firstHalf.trim().length > 0) {
        return {
          stuck: true,
          reason: 'Output is repeating (same lines appearing in a loop)',
          matchedPattern: 'exact-repeat',
          matchCount: half
        }
      }
    }

    return { stuck: false }
  }
}
