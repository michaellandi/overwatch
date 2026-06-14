import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startMcpServer } from '../src/main/mcp-server'
import type { Session, Tab } from '../src/shared/types'

const TEST_PORT = 3799

// Minimal mock orchestrator — no Electron, no PTY
function makeOrchestrator() {
  const sessions: Session[] = []
  const peeked: Array<{ tabId: string; lines: number }> = []
  const told: Array<{ sessionId: string; message: string; tabId?: string }> = []
  const killed: string[] = []
  const closed: Array<{ sessionId: string; tabId: string }> = []

  return {
    _sessions: sessions,
    _peeked: peeked,
    _told: told,
    _killed: killed,
    _closed: closed,

    getSessions: () => sessions,

    peekTab: (tabId: string, lines: number) => {
      peeked.push({ tabId, lines })
      const session = sessions.find(s => s.tabs.some(t => t.id === tabId))
      return session ? `output from ${tabId}` : ''
    },

    tellSession: (sessionId: string, message: string, tabId?: string) => {
      told.push({ sessionId, message, tabId })
    },

    killSession: (sessionId: string) => {
      killed.push(sessionId)
      const idx = sessions.findIndex(s => s.id === sessionId)
      if (idx !== -1) sessions.splice(idx, 1)
    },

    createSession: (goal: string, dir: string): Session => {
      if (dir === '/nonexistent') throw new Error(`Directory not found: ${dir}`)
      const tab: Tab = { id: 'tab-1', name: 'agent', type: 'agent', command: 'claude' }
      const session: Session = {
        id: `session-${sessions.length + 1}`,
        name: goal,
        goal,
        workingDir: dir,
        state: 'working',
        tabs: [tab],
        activeTabId: tab.id,
        createdAt: Date.now(),
        lastActivityAt: Date.now()
      }
      sessions.push(session)
      return session
    },

    addTab: (sessionId: string, type: 'agent' | 'terminal', command?: string): Tab | null => {
      const session = sessions.find(s => s.id === sessionId)
      if (!session) return null
      const tab: Tab = { id: `tab-${session.tabs.length + 1}`, name: type, type, command: command ?? '' }
      session.tabs.push(tab)
      return tab
    },

    closeTab: (sessionId: string, tabId: string) => {
      closed.push({ sessionId, tabId })
      const session = sessions.find(s => s.id === sessionId)
      if (session) session.tabs = session.tabs.filter(t => t.id !== tabId)
    }
  }
}

type MockOrchestrator = ReturnType<typeof makeOrchestrator>

let mcpHandle: { close: () => Promise<void> }
let client: Client
let orchestrator: MockOrchestrator

beforeAll(async () => {
  orchestrator = makeOrchestrator()
  mcpHandle = await startMcpServer(orchestrator as never, TEST_PORT)

  client = new Client({ name: 'test', version: '0.0.1' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${TEST_PORT}/mcp`))
  await client.connect(transport)
}, 10_000)

afterAll(async () => {
  await client.close()
  await mcpHandle.close()
})

describe('MCP server — tool discovery', () => {
  it('lists all expected tools', async () => {
    const { tools } = await client.listTools()
    const names = tools.map(t => t.name).sort()
    expect(names).toEqual([
      'sessions_create',
      'sessions_kill',
      'sessions_list',
      'sessions_peek',
      'sessions_tell',
      'tabs_add',
      'tabs_close'
    ])
  })

  it('tools have descriptions', async () => {
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.description, `${tool.name} missing description`).toBeTruthy()
    }
  })
})

describe('MCP server — sessions_list', () => {
  it('returns empty array when no sessions', async () => {
    orchestrator._sessions.length = 0
    const result = await client.callTool({ name: 'sessions_list', arguments: {} })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(JSON.parse(text)).toEqual([])
  })

  it('returns sessions when present', async () => {
    orchestrator.createSession('test goal', '/tmp')
    const result = await client.callTool({ name: 'sessions_list', arguments: {} })
    const text = (result.content as Array<{ text: string }>)[0].text
    const sessions = JSON.parse(text)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].goal).toBe('test goal')
  })
})

describe('MCP server — sessions_peek', () => {
  beforeAll(() => {
    orchestrator._sessions.length = 0
    orchestrator.createSession('peek-session', '/tmp')
  })

  it('returns output for a known session using activeTabId', async () => {
    const session = orchestrator._sessions[0]
    const result = await client.callTool({ name: 'sessions_peek', arguments: { sessionId: session.id } })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).toBe(`output from ${session.activeTabId}`)
  })

  it('uses provided tabId when given', async () => {
    const session = orchestrator._sessions[0]
    const result = await client.callTool({ name: 'sessions_peek', arguments: { sessionId: session.id, tabId: session.activeTabId, lines: 10 } })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).toBe(`output from ${session.activeTabId}`)
    const lastPeek = orchestrator._peeked.at(-1)
    expect(lastPeek?.lines).toBe(10)
  })

  it('returns Session not found for unknown session', async () => {
    const result = await client.callTool({ name: 'sessions_peek', arguments: { sessionId: 'does-not-exist' } })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).toBe('Session not found')
  })
})

describe('MCP server — sessions_tell', () => {
  beforeAll(() => {
    orchestrator._sessions.length = 0
    orchestrator._told.length = 0
    orchestrator.createSession('tell-session', '/tmp')
  })

  it('calls tellSession and returns Sent.', async () => {
    const session = orchestrator._sessions[0]
    const result = await client.callTool({ name: 'sessions_tell', arguments: { sessionId: session.id, message: 'hello' } })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).toBe('Sent.')
    expect(orchestrator._told).toContainEqual({ sessionId: session.id, message: 'hello', tabId: undefined })
  })

  it('forwards tabId when provided', async () => {
    const session = orchestrator._sessions[0]
    const result = await client.callTool({ name: 'sessions_tell', arguments: { sessionId: session.id, message: 'hi', tabId: 'tab-1' } })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).toBe('Sent.')
    expect(orchestrator._told.at(-1)).toMatchObject({ tabId: 'tab-1' })
  })
})

describe('MCP server — sessions_kill', () => {
  beforeAll(() => {
    orchestrator._sessions.length = 0
    orchestrator._killed.length = 0
    orchestrator.createSession('kill-me', '/tmp')
  })

  it('kills a session and returns Killed.', async () => {
    const session = orchestrator._sessions[0]
    const result = await client.callTool({ name: 'sessions_kill', arguments: { sessionId: session.id } })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).toBe('Killed.')
    expect(orchestrator._killed).toContain(session.id)
    expect(orchestrator._sessions).toHaveLength(0)
  })
})

describe('MCP server — sessions_create', () => {
  beforeAll(() => {
    orchestrator._sessions.length = 0
  })

  it('creates a session and returns its JSON', async () => {
    const result = await client.callTool({ name: 'sessions_create', arguments: { goal: 'build feature', dir: '/tmp' } })
    const text = (result.content as Array<{ text: string }>)[0].text
    const session = JSON.parse(text)
    expect(session.goal).toBe('build feature')
    expect(session.workingDir).toBe('/tmp')
    expect(session.tabs).toHaveLength(1)
  })

  it('uses ~ as default dir when dir is omitted', async () => {
    const result = await client.callTool({ name: 'sessions_create', arguments: { goal: 'no-dir' } })
    const text = (result.content as Array<{ text: string }>)[0].text
    const session = JSON.parse(text)
    expect(session.workingDir).toBe('~')
  })

  it('returns an Error string when orchestrator throws', async () => {
    const result = await client.callTool({ name: 'sessions_create', arguments: { goal: 'bad', dir: '/nonexistent' } })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).toMatch(/^Error:/)
    expect(text).toContain('/nonexistent')
  })
})

describe('MCP server — tabs_add', () => {
  beforeAll(() => {
    orchestrator._sessions.length = 0
    orchestrator.createSession('tab-session', '/tmp')
  })

  it('adds a terminal tab and returns its JSON', async () => {
    const session = orchestrator._sessions[0]
    const result = await client.callTool({ name: 'tabs_add', arguments: { sessionId: session.id, type: 'terminal' } })
    const text = (result.content as Array<{ text: string }>)[0].text
    const tab = JSON.parse(text)
    expect(tab.type).toBe('terminal')
    expect(orchestrator._sessions[0].tabs).toHaveLength(2)
  })

  it('adds an agent tab with a custom command', async () => {
    const session = orchestrator._sessions[0]
    const result = await client.callTool({ name: 'tabs_add', arguments: { sessionId: session.id, type: 'agent', command: 'kiro-cli chat' } })
    const text = (result.content as Array<{ text: string }>)[0].text
    const tab = JSON.parse(text)
    expect(tab.command).toBe('kiro-cli chat')
  })

  it('returns Session not found for unknown session', async () => {
    const result = await client.callTool({ name: 'tabs_add', arguments: { sessionId: 'ghost', type: 'terminal' } })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).toBe('Session not found')
  })
})

describe('MCP server — tabs_close', () => {
  beforeAll(() => {
    orchestrator._sessions.length = 0
    orchestrator._closed.length = 0
    orchestrator.createSession('close-session', '/tmp')
  })

  it('closes a tab and returns Closed.', async () => {
    const session = orchestrator._sessions[0]
    const tabId = session.tabs[0].id
    const result = await client.callTool({ name: 'tabs_close', arguments: { sessionId: session.id, tabId } })
    const text = (result.content as Array<{ text: string }>)[0].text
    expect(text).toBe('Closed.')
    expect(orchestrator._closed).toContainEqual({ sessionId: session.id, tabId })
    expect(orchestrator._sessions[0].tabs).toHaveLength(0)
  })
})

describe('MCP server — HTTP routing', () => {
  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/unknown`)
    expect(res.status).toBe(404)
  })

  it('responds to POST to /mcp (not 404)', async () => {
    // A raw POST — the transport may reject a bare request with 400 (missing/wrong session),
    // but it must not 404. A non-404 means the route is wired up correctly.
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'raw-test', version: '0' } } })
    })
    expect(res.status).not.toBe(404)
  })
})
