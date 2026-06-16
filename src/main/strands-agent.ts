import { BrowserWindow } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Orchestrator } from './orchestrator'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { getProvider } from './providers'
import type { LLMProvider, LLMMessage, LLMTool, ProviderSettings } from './providers'

const SYSTEM_PROMPT = `You are Overwatch, an orchestrator agent supervising multiple AI coding sessions running in parallel.

Your role is to COORDINATE, not to DO. You are a manager, not an individual contributor.

RULES:
- NEVER write code, implement features, or solve coding problems yourself
- ALWAYS delegate coding, debugging, refactoring, and implementation tasks to sessions
- Create a new session (or tell an existing one) when the user asks for any hands-on work
- Your job: plan, decompose tasks, assign work to agents, monitor progress, report status, and unblock stuck sessions
- When a user asks you to do something technical, create a session with the right agent, directory, and prompt — then monitor it

When creating sessions or taking actions:
- Explain your reasoning ("I'll create a kiro session in ~/projects/auth-service for this")
- State which directory/repo and why
- Describe what you're telling the agent to do
- After creating a session, confirm what was set up

You CAN answer questions about architecture, planning, strategy, and status directly.
Be concise and direct. Keep responses under 200 words unless the user asks for detail.`

type ToolDef = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (input: Record<string, unknown>) => string
}

export class OverwatchAgent {
  private provider: LLMProvider
  private tools: ToolDef[] = []
  private mcpClients: Array<{ name: string; client: Client; tools: ToolDef[] }> = []
  private messages: LLMMessage[] = []
  private systemPrompt: string = SYSTEM_PROMPT
  private abortController: AbortController | null = null

  constructor() {
    this.provider = getProvider({ provider: 'bedrock', awsRegion: 'us-west-2' })
  }

  configure(settings: ProviderSettings): void {
    if (settings.provider === 'bedrock') {
      process.env.AWS_PROFILE = settings.awsProfile ?? 'default'
      process.env.AWS_REGION = settings.awsRegion ?? 'us-west-2'
    }
    this.provider = getProvider(settings)
  }

  injectEvent(summary: string, sessionId?: string, tabId?: string): void {
    const meta = [sessionId && `sessionId: ${sessionId}`, tabId && `tabId: ${tabId}`].filter(Boolean).join(', ')
    this.messages.push({ role: 'user', content: [{ type: 'text', text: `[EVENT]${meta ? ` (${meta})` : ''} ${summary}` }] })
    this.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Noted.' }] })
  }

  start(orchestrator: Orchestrator, contextDir: string): void {
    let customInstructions = ''
    try { customInstructions = '\n\n' + readFileSync(join(contextDir, 'AGENTS.md'), 'utf-8') } catch {}
    this.systemPrompt = SYSTEM_PROMPT + customInstructions

    this.tools = [
      {
        name: 'sessions_list',
        description: 'List all sessions with state, tabs, and goals',
        inputSchema: { type: 'object', properties: {}, required: [] },
        handler: () => JSON.stringify(orchestrator.getSessions(), null, 2)
      },
      {
        name: 'sessions_peek',
        description: 'Get recent terminal output from a session',
        inputSchema: { type: 'object', properties: { sessionId: { type: 'string', description: 'Session ID or name' }, lines: { type: 'number', description: 'Lines (default 30)' } }, required: ['sessionId'] },
        handler: (input) => {
          const session = orchestrator.getSessions().find(s => s.id === input.sessionId || s.name === input.sessionId)
          if (!session) return 'Session not found'
          return orchestrator.peekTab(session.activeTabId, (input.lines as number) ?? 30) || '(no output)'
        }
      },
      {
        name: 'sessions_tell',
        description: 'Send text input to a session. Use the session ID or name. Include tabId when responding to a specific tab event.',
        inputSchema: { type: 'object', properties: { sessionId: { type: 'string', description: 'Session ID or name' }, message: { type: 'string' }, tabId: { type: 'string', description: 'Tab ID to target (from event context)' } }, required: ['sessionId', 'message'] },
        handler: (input) => { orchestrator.tellSession(input.sessionId as string, input.message as string, input.tabId as string | undefined); return 'Sent.' }
      },
      {
        name: 'sessions_create',
        description: 'Create a new session with an AI agent to work on a task. The agent will be started with the full task description.',
        inputSchema: { type: 'object', properties: {
          goal: { type: 'string', description: 'Short name for the session' },
          task: { type: 'string', description: 'Full task description/instructions for the agent' },
          dir: { type: 'string', description: 'Working directory (absolute path)' },
          agent: { type: 'string', description: 'Agent to use: kiro, claude, or terminal (default: kiro)' }
        }, required: ['goal', 'task'] },
        handler: (input) => {
          const agentType = (input.agent as string) ?? 'kiro'
          const dir = (input.dir as string) ?? '~'
          const task = input.task as string

          let command: string
          if (agentType === 'claude') command = 'claude'
          else if (agentType === 'terminal') command = process.env.SHELL ?? '/bin/zsh'
          else command = 'kiro-cli chat'

          let session
          try {
            session = orchestrator.createSession(input.goal as string, dir, {
              type: agentType === 'terminal' ? 'terminal' : 'agent',
              command
            })
          } catch (err) {
            return `Error: ${(err as Error).message}`
          }

          if (agentType !== 'terminal') {
            setTimeout(() => {
              const tab = session.tabs[0]
              if (tab) {
                const pty = orchestrator.getPty(tab.id)
                if (pty) pty.write(task + '\r')
              }
            }, 2000)
          }

          return JSON.stringify(session, null, 2)
        }
      },
      {
        name: 'sessions_kill',
        description: 'Kill and remove a session',
        inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
        handler: (input) => { orchestrator.killSession(input.sessionId as string); return 'Killed.' }
      },
      {
        name: 'file_read',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute or relative to context dir' } }, required: ['path'] },
        handler: (input) => {
          const p = (input.path as string).startsWith('/') ? input.path as string : join(contextDir, input.path as string)
          try { return readFileSync(p, 'utf-8') } catch (e) { return `Error: ${(e as Error).message}` }
        }
      },
      {
        name: 'file_list',
        description: 'List files in a directory',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        handler: (input) => {
          const p = (input.path as string).startsWith('/') ? input.path as string : join(contextDir, input.path as string)
          try { return readdirSync(p).map(e => { try { return statSync(join(p, e)).isDirectory() ? e + '/' : e } catch { return e } }).join('\n') }
          catch (e) { return `Error: ${(e as Error).message}` }
        }
      },
      {
        name: 'file_grep',
        description: 'Search for a regex pattern in files',
        inputSchema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern', 'path'] },
        handler: (input) => {
          const p = (input.path as string).startsWith('/') ? input.path as string : join(contextDir, input.path as string)
          try { return execSync(`grep -rn "${(input.pattern as string).replace(/"/g, '\\"')}" "${p}" --include="*.ts" --include="*.js" --include="*.md" --include="*.json" | head -50`, { encoding: 'utf-8', timeout: 5000 }) }
          catch { return 'No matches.' }
        }
      }
    ]
  }

  async connectMcpServers(servers: Array<{ name: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> }>): Promise<void> {
    for (const mc of this.mcpClients) { try { await mc.client.close() } catch {} }
    this.mcpClients = []

    const home = process.env.HOME ?? ''
    const extraPath = `${home}/.local/bin:/usr/local/bin:/opt/homebrew/bin`

    for (const server of servers) {
      try {
        const client = new Client({ name: 'overwatch', version: '0.1.0' })

        if (server.command) {
          const transport = new StdioClientTransport({
            command: server.command,
            args: server.args ?? [],
            env: { ...process.env, ...server.env, PATH: `${extraPath}:${process.env.PATH ?? ''}` } as Record<string, string>
          })
          await client.connect(transport)
        } else if (server.url) {
          const transport = new StreamableHTTPClientTransport(new URL(server.url))
          await client.connect(transport)
        } else {
          continue
        }

        const { tools: mcpTools } = await client.listTools()
        const toolDefs: ToolDef[] = mcpTools.map(t => ({
          name: `${server.name}__${t.name}`,
          description: `[${server.name}] ${t.description ?? t.name}`,
          inputSchema: (t.inputSchema ?? { type: 'object', properties: {}, required: [] }) as Record<string, unknown>,
          handler: () => ''
        }))

        this.mcpClients.push({ name: server.name, client, tools: toolDefs })
        console.log(`[overwatch] Connected to MCP "${server.name}" (${toolDefs.length} tools)`)
      } catch (err) {
        console.error(`[overwatch] Failed to connect MCP "${server.name}":`, (err as Error).message)
      }
    }
  }

  private getAllTools(): LLMTool[] {
    const all = [...this.tools, ...this.mcpClients.flatMap(mc => mc.tools)]
    return all.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
  }

  private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    for (const mc of this.mcpClients) {
      const mcpTool = mc.tools.find(t => t.name === name)
      if (mcpTool) {
        const realName = name.split('__').slice(1).join('__')
        try {
          const result = await mc.client.callTool({ name: realName, arguments: input })
          return (result.content as Array<{ text?: string }>)?.map(c => c.text ?? '').join('\n') || 'Done.'
        } catch (e) { return `Error: ${(e as Error).message}` }
      }
    }
    const toolDef = this.tools.find(t => t.name === name)
    if (!toolDef) return 'Tool not found'
    try { return toolDef.handler(input) }
    catch (e) { return `Error: ${(e as Error).message}` }
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  async ask(message: string): Promise<string> {
    const win = BrowserWindow.getAllWindows()[0]
    this.messages.push({ role: 'user', content: [{ type: 'text', text: message }] })
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    const tools = this.getAllTools()

    try {
      let fullText = ''

      while (true) {
        if (signal.aborted) break

        const result = await this.provider.stream({
          system: this.systemPrompt,
          messages: this.messages,
          tools,
          signal,
          onText: (chunk) => { fullText += chunk; win?.webContents.send('overwatch:chat-stream', chunk) },
          onToolCall: (name, input) => win?.webContents.send('overwatch:tool-call', { name, input })
        })

        if (!result.toolCall) {
          this.messages.push({ role: 'assistant', content: [{ type: 'text', text: result.text }] })
          break
        }

        const { id: toolUseId, name: toolName, input: toolInput } = result.toolCall
        const toolResult = await this.executeTool(toolName, JSON.parse(toolInput || '{}'))

        const summary = toolResult.length > 200 ? toolResult.slice(0, 200) + '...' : toolResult
        win?.webContents.send('overwatch:tool-result', { name: toolName, result: summary })

        this.messages.push({
          role: 'assistant',
          content: [
            ...(result.text ? [{ type: 'text' as const, text: result.text }] : []),
            { type: 'tool_use' as const, id: toolUseId, name: toolName, input: JSON.parse(toolInput || '{}') }
          ]
        })
        this.messages.push({
          role: 'user',
          content: [{ type: 'tool_result' as const, tool_use_id: toolUseId, content: toolResult }]
        })
      }

      win?.webContents.send('overwatch:chat-done')
      return fullText || 'Done.'
    } catch (err) {
      const errMsg = (err as Error).message ?? String(err)
      const isAuthError = /AccessDenied|UnrecognizedClient|InvalidClientToken|ExpiredToken|NoCredential|could not be found|not authorized|invalid x-api-key|authentication/i.test(errMsg)
      const msg = isAuthError
        ? `⚠️ **Provider access failed** — check your credentials in Settings.\n\n\`${errMsg}\``
        : `⚠️ **Agent error** — ${errMsg}`
      console.error('[overwatch] Agent error:', err)
      win?.webContents.send('overwatch:chat-stream', msg)
      win?.webContents.send('overwatch:chat-done')
      return msg
    }
  }
}
