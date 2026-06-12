import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

describe('Approval notification cycle prevention', () => {
  const source = readFileSync('./src/main/orchestrator.ts', 'utf-8')

  describe('onTabActivity resumes blocked sessions only when approval clears', () => {
    it('re-checks detector before resuming a blocked session', () => {
      // When blocked, new output triggers a re-check of the detector
      // Only resumes if the approval prompt is no longer in the buffer
      expect(source).toContain("session.state === 'blocked'")
      expect(source).toContain("!result.approval")
    })

    it('skips data with no substantive content', () => {
      const methodStart = source.indexOf('private onTabActivity(')
      const methodBlock = source.slice(methodStart, methodStart + 1000)
      expect(methodBlock).toContain('if (lines.length === 0) return')
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
