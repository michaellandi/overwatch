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

  lines(): string[] {
    if (!this.full) return this.buf.slice(0, this.pos)
    return [...this.buf.slice(this.pos), ...this.buf.slice(0, this.pos)]
  }

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

// Patterns indicating an agent is waiting for user approval/input
const APPROVAL_PATTERNS: RegExp[] = [
  // Claude Code prompts
  /❯\s*$/,
  /\? \(y\/n\)/i,
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /Press enter to continue/i,
  /Do you want to/i,
  // Kiro prompts
  /You:\s*$/,
  /⏎/,
  /requires approval/i,
  /❯\s*(Yes|No|Trust)/,
  /Tab to edit/,
  /waiting for your/i,
]

export interface DetectorResult {
  approval: boolean
  reason?: string
}

/**
 * Checks the tail of session output for approval/input prompts.
 * Idle detection is handled separately via timer in the orchestrator.
 */
export class ApprovalDetector {
  private patterns: RegExp[]

  constructor(patterns?: RegExp[]) {
    this.patterns = patterns ?? APPROVAL_PATTERNS
  }

  analyze(buffer: RingBuffer): DetectorResult {
    const tail = buffer.last(30)
    for (const line of tail) {
      for (const pattern of this.patterns) {
        if (pattern.test(line)) {
          return { approval: true, reason: `Agent is waiting for input` }
        }
      }
    }
    return { approval: false }
  }
}
