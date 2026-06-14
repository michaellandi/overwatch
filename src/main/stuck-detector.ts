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
  // NOTE: bare /❯\s*$/ is intentionally absent — Claude Code uses ❯ as a
  // general TUI element (tool step bullets, input cursor chrome) on almost
  // every output line, causing constant false positives. Real permission
  // menus are caught by /❯\s*(Yes|No|Trust)/ below.
  /\? \(y\/n\)/i,
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /Press enter to continue/i,
  /Do you want to/i,
  /allow once/i,
  /trust all tools/i,
  // Claude Code permission dialog footer (always present)
  /Esc to cancel/i,
  // ❯ cursor on a known permission dialog option, with optional numbering (e.g. "❯ 1. Yes")
  /❯\s+(\d+\.\s+)?(yes|no|trust|allow|deny|approve|reject)/i,
  // Kiro prompts — only patterns that appear exclusively on the approval screen,
  // not in normal thinking/processing output or conversation history display.
  /requires approval/i,
  /❯\s*(?:\d+\.\s*)?(Yes|No|Trust)/,
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
