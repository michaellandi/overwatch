import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

describe('tellSession carriage return', () => {
  it('sends message with \\r not \\n to PTY', () => {
    const source = readFileSync('./src/main/orchestrator.ts', 'utf-8')
    // tellSession should use \r (carriage return) for PTY
    expect(source).toContain("pty.write(message + '\\r')")
    // Should NOT use \n (linefeed)
    expect(source).not.toContain("pty.write(message + '\\n')")
  })

  it('initial prompt uses \\r for PTY enter key', () => {
    const source = readFileSync('./src/main/index.ts', 'utf-8')
    // Initial prompt sent after session creation should also use \r
    expect(source).toContain("initialPrompt + '\\r'")
  })
})
