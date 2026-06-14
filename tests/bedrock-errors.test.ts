import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const BEDROCK_AUTH_RE = /AccessDenied|UnrecognizedClient|InvalidClientToken|ExpiredToken|NoCredential|could not be found|not authorized/i

describe('Bedrock error visibility', () => {
  describe('summarizeBlocked fallback includes error detail', () => {
    const source = readFileSync('./src/main/orchestrator.ts', 'utf-8')
    const catchStart = source.indexOf('[summarize] error:')
    const catchBlock = source.slice(catchStart, catchStart + 300)

    it('exposes the error message in the fallback string', () => {
      expect(catchBlock).toContain('errMsg')
    })

    it('labels it as Bedrock unavailable', () => {
      expect(catchBlock).toContain('Bedrock unavailable')
    })

    it('returns a string that includes the error', () => {
      expect(catchBlock).toContain('errMsg.slice(0, 120)')
    })
  })

  describe('ask() surfaces Bedrock auth failures distinctly', () => {
    const source = readFileSync('./src/main/strands-agent.ts', 'utf-8')
    const catchStart = source.indexOf('[overwatch] Agent error:')
    const catchBlock = source.slice(catchStart - 400, catchStart + 200)

    it('checks for auth-related error patterns', () => {
      expect(catchBlock).toContain('isBedrockAuth')
    })

    it('auth errors direct user to Settings', () => {
      expect(catchBlock).toContain('check your AWS credentials and region in Settings')
    })

    it('non-auth errors use a generic agent error label', () => {
      expect(catchBlock).toContain('Agent error')
    })

    it('always sends chat-stream with the error message', () => {
      expect(catchBlock).toContain("'overwatch:chat-stream'")
    })

    it('always sends chat-done to close the streaming state', () => {
      expect(catchBlock).toContain("'overwatch:chat-done'")
    })
  })

  describe('auth error regex classification', () => {
    it.each([
      'AccessDeniedException: User is not authorized to perform: bedrock:InvokeModelWithResponseStream',
      'UnrecognizedClientException: The security token included in the request is invalid',
      'InvalidClientTokenId: The security token included in the request is invalid',
      'ExpiredTokenException: The security token included in the request is expired',
      'NoCredentialProviders: no valid providers in chain',
      'Profile could not be found',
      'User is not authorized to perform this operation',
    ])('classifies as auth error: %s', (msg) => {
      expect(BEDROCK_AUTH_RE.test(msg)).toBe(true)
    })

    it.each([
      'ThrottlingException: Rate exceeded',
      'ServiceUnavailableException: The service is unavailable',
      'ValidationException: The provided model identifier is invalid',
      'Network error: ECONNREFUSED',
      'Error: stream closed unexpectedly',
    ])('does not classify as auth error: %s', (msg) => {
      expect(BEDROCK_AUTH_RE.test(msg)).toBe(false)
    })
  })
})
