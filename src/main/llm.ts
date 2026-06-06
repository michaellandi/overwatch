import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime'
import { BrowserWindow } from 'electron'
import type { Orchestrator } from './orchestrator'

const MODEL_ID = 'us.anthropic.claude-sonnet-4-6'
const REGION = 'us-west-2'

const SYSTEM_PROMPT = `You are Overwatch, an orchestrator agent supervising multiple AI coding sessions running in parallel.

You have full visibility into all sessions. The session data below includes recent terminal output — use it directly to answer questions. You do NOT need any external tools to see session output, it is provided to you in the context.

Your capabilities:
- Report on session status (running, stuck, done)
- Read and interpret recent terminal output from any session (it's in your context below)
- Suggest interventions when sessions are stuck
- Help the user decide what to do next

Be concise and direct. Use the session data provided to give specific, actionable responses. When asked to peek or show output, quote the relevant output from the context.`

interface QueuedMessage {
  id: string
  message: string
  source: string // 'ui' | 'mcp' | 'system'
  resolve: (response: string) => void
}

export class OverwatchLLM {
  private client: BedrockRuntimeClient
  private queue: QueuedMessage[] = []
  private processing = false

  constructor() {
    this.client = new BedrockRuntimeClient({ region: REGION })
  }

  async ask(message: string, orchestrator: Orchestrator, source = 'ui'): Promise<string> {
    const id = crypto.randomUUID()
    return new Promise<string>(resolve => {
      this.queue.push({ id, message, source, resolve })
      this.processQueue(orchestrator)
    })
  }

  cancelQueued(id: string): boolean {
    const idx = this.queue.findIndex(q => q.id === id)
    if (idx >= 0) {
      const [removed] = this.queue.splice(idx, 1)
      removed.resolve('[cancelled]')
      return true
    }
    return false
  }

  getQueuedIds(): string[] {
    return this.queue.map(q => q.id)
  }

  private async processQueue(orchestrator: Orchestrator): Promise<void> {
    if (this.processing || this.queue.length === 0) return
    this.processing = true

    while (this.queue.length > 0) {
      const item = this.queue.shift()!
      const response = await this.invoke(item.message, item.source, orchestrator)
      item.resolve(response)
    }

    this.processing = false
  }

  private async invoke(message: string, source: string, orchestrator: Orchestrator): Promise<string> {
    const context = this.buildContext(orchestrator)
    const win = BrowserWindow.getAllWindows()[0]
    const sourceLabel = source === 'ui' ? '' : `[from: ${source}] `

    console.log('[overwatch] LLM invoke, win exists:', !!win)

    try {
      const response = await this.client.send(new InvokeModelWithResponseStreamCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user', content: `${context}\n\n---\n\n${sourceLabel}Message: ${message}` }
          ]
        })
      }))

      let full = ''
      if (response.body) {
        for await (const event of response.body) {
          if (event.chunk?.bytes) {
            const json = JSON.parse(new TextDecoder().decode(event.chunk.bytes))
            if (json.type === 'content_block_delta' && json.delta?.text) {
              full += json.delta.text
              win?.webContents.send('overwatch:chat-stream', json.delta.text)
            }
          }
        }
      }
      console.log('[overwatch] LLM done, length:', full.length)
      win?.webContents.send('overwatch:chat-done')
      return full || 'No response.'
    } catch (err) {
      console.error('[overwatch] LLM error, falling back to deterministic:', err)
      const fallback = orchestrator.handleMessage(message)
      win?.webContents.send('overwatch:chat-stream', fallback)
      win?.webContents.send('overwatch:chat-done')
      return fallback
    }
  }

  private buildContext(orchestrator: Orchestrator): string {
    const sessions = orchestrator.getSessions()
    if (sessions.length === 0) return 'No active sessions.'

    const parts = sessions.map(s => {
      const lines = [`Session: "${s.name}" [${s.state}]`, `  Goal: ${s.goal}`, `  Dir: ${s.workingDir}`]
      for (const tab of s.tabs) {
        const buffer = orchestrator.peekTab(tab.id, 30)
        lines.push(`  Tab "${tab.name}" (${tab.type}):`)
        if (buffer) {
          lines.push('    --- recent output ---')
          lines.push(...buffer.split('\n').map(l => '    ' + l))
        } else {
          lines.push('    (no output captured)')
        }
      }
      return lines.join('\n')
    })

    return `Current sessions:\n\n${parts.join('\n\n')}`
  }
}
