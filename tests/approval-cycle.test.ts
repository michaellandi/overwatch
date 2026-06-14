import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

describe('Approval notification cycle prevention', () => {
  const source = readFileSync('./src/main/orchestrator.ts', 'utf-8')

  describe('onTabActivity does NOT auto-resume blocked sessions on data', () => {
    it('terminal:write is the sole unblock path in onTabActivity', () => {
      // Path 2 (auto-resume on clean output) was removed because spinner output
      // after Path 1a buffer-clear would falsely resume the session while the
      // approval dialog was still visible.  Only terminal:write / tellSession resume.
      const methodStart = source.indexOf('private onTabActivity(')
      const methodBlock = source.slice(methodStart, methodStart + 2000)
      // The method should not contain "session:resumed" (that belongs in terminal:write)
      expect(methodBlock).not.toContain("'session:resumed'")
    })

    it('skips data with no substantive content', () => {
      const methodStart = source.indexOf('private onTabActivity(')
      const methodBlock = source.slice(methodStart, methodStart + 1000)
      expect(methodBlock).toContain('if (lines.length === 0) return')
    })
  })

  describe('terminal:write is the primary unblock path for approval', () => {
    it('terminal:write checks for approval block before resuming', () => {
      const writeStart = source.indexOf("ipcMain.on('terminal:write'")
      const writeBlock = source.slice(writeStart, writeStart + 1200)
      expect(writeBlock).toContain("blockedReason === 'approval'")
      expect(writeBlock).toContain("session.state = 'working'")
    })

    it('terminal:write sets needsCleanOutput to suppress TUI repaint detection', () => {
      const writeStart = source.indexOf("ipcMain.on('terminal:write'")
      const writeBlock = source.slice(writeStart, writeStart + 1200)
      expect(writeBlock).toContain('needsCleanOutput')
    })
  })

  describe('tellSession clears approval block', () => {
    it('checks for approval block before writing to PTY', () => {
      const tellStart = source.indexOf('tellSession(sessionId: string')
      const tellBlock = source.slice(tellStart, tellStart + 400)
      expect(tellBlock).toContain("blockedReason === 'approval'")
    })

    it('sets state to working when clearing approval block', () => {
      const tellStart = source.indexOf('tellSession(sessionId: string')
      const tellBlock = source.slice(tellStart, tellStart + 400)
      expect(tellBlock).toContain("session.state = 'working'")
    })

    it('clears blockedReason when clearing approval block', () => {
      const tellStart = source.indexOf('tellSession(sessionId: string')
      const tellBlock = source.slice(tellStart, tellStart + 400)
      expect(tellBlock).toContain("session.blockedReason = undefined")
    })
  })

  describe('checkHealth only fires approval for working sessions', () => {
    it('approval detection is guarded by working state', () => {
      const checkStart = source.indexOf('private checkHealth(')
      const checkBlock = source.slice(checkStart, checkStart + 1200)
      // The approval detection should be inside a working state check
      const workingIdx = checkBlock.indexOf("session.state === 'working'")
      const approvalIdx = checkBlock.indexOf("result.approval")
      expect(workingIdx).toBeGreaterThan(-1)
      expect(approvalIdx).toBeGreaterThan(workingIdx)
    })
  })
})
