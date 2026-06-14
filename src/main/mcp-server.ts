import { createServer } from 'http'
import type { Server } from 'http'
import crypto from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { Orchestrator } from './orchestrator'

export const MCP_PORT = 3777

export async function startMcpServer(orchestrator: Orchestrator, port = MCP_PORT): Promise<{ close: () => Promise<void> }> {
  const server = new McpServer({
    name: 'overwatch',
    version: '0.1.0'
  })

  server.tool('sessions_list', 'List all sessions with state, tabs, and goals', {}, async () => {
    const sessions = orchestrator.getSessions()
    return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] }
  })

  server.tool('sessions_peek', 'Get recent terminal output from a session tab', {
    sessionId: z.string().describe('Session ID'),
    tabId: z.string().optional().describe('Tab ID (defaults to active tab)'),
    lines: z.number().optional().describe('Number of lines (default 30)')
  }, async ({ sessionId, tabId, lines }) => {
    const session = orchestrator.getSessions().find(s => s.id === sessionId)
    if (!session) return { content: [{ type: 'text', text: 'Session not found' }] }
    const tid = tabId ?? session.activeTabId
    const output = orchestrator.peekTab(tid, lines ?? 30)
    return { content: [{ type: 'text', text: output || '(no output)' }] }
  })

  server.tool('sessions_tell', 'Send text input to a session tab', {
    sessionId: z.string().describe('Session ID or name'),
    message: z.string().describe('Text to send'),
    tabId: z.string().optional().describe('Tab ID to target (defaults to active tab)')
  }, async ({ sessionId, message, tabId }) => {
    orchestrator.tellSession(sessionId, message, tabId)
    return { content: [{ type: 'text', text: 'Sent.' }] }
  })

  server.tool('sessions_kill', 'Kill and remove a session', {
    sessionId: z.string().describe('Session ID or name')
  }, async ({ sessionId }) => {
    orchestrator.killSession(sessionId)
    return { content: [{ type: 'text', text: 'Killed.' }] }
  })

  server.tool('sessions_create', 'Create a new session', {
    goal: z.string().describe('Goal/name for the session'),
    dir: z.string().optional().describe('Working directory (must exist)')
  }, async ({ goal, dir }) => {
    try {
      const session = orchestrator.createSession(goal, dir ?? '~')
      return { content: [{ type: 'text', text: JSON.stringify(session, null, 2) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }] }
    }
  })

  server.tool('tabs_add', 'Add a tab to a session', {
    sessionId: z.string().describe('Session ID'),
    type: z.enum(['agent', 'terminal']),
    command: z.string().optional().describe('Command (e.g. "kiro-cli chat")')
  }, async ({ sessionId, type, command }) => {
    const tab = orchestrator.addTab(sessionId, type, command)
    if (!tab) return { content: [{ type: 'text', text: 'Session not found' }] }
    return { content: [{ type: 'text', text: JSON.stringify(tab, null, 2) }] }
  })

  server.tool('tabs_close', 'Close a tab in a session', {
    sessionId: z.string().describe('Session ID'),
    tabId: z.string().describe('Tab ID')
  }, async ({ sessionId, tabId }) => {
    orchestrator.closeTab(sessionId, tabId)
    return { content: [{ type: 'text', text: 'Closed.' }] }
  })

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() })

  const httpServer: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    if (url.pathname === '/mcp') {
      await transport.handleRequest(req, res)
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  })

  await server.connect(transport)

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, '127.0.0.1', resolve)
    httpServer.once('error', reject)
  })

  console.log(`[overwatch] MCP server listening on http://127.0.0.1:${port}/mcp`)

  return {
    close: async () => {
      await server.close()
      await new Promise<void>((resolve, reject) => {
        httpServer.close(err => err ? reject(err) : resolve())
      })
    }
  }
}
