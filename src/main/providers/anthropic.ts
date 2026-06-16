import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LLMMessage, LLMTool, StreamResult, LLMContentBlock } from './types'

const MODEL_ID = 'claude-sonnet-4-6'

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async stream(opts: {
    system: string
    messages: LLMMessage[]
    tools: LLMTool[]
    signal?: AbortSignal
    onText: (chunk: string) => void
    onToolCall: (name: string, input: string) => void
  }): Promise<StreamResult> {
    const messages = opts.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string'
        ? m.content
        : (m.content as LLMContentBlock[]).map(b => {
            if (b.type === 'text') return { type: 'text' as const, text: b.text }
            if (b.type === 'tool_use') return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input }
            return { type: 'tool_result' as const, tool_use_id: b.tool_use_id, content: b.content }
          })
    }))

    const stream = this.client.messages.stream({
      model: MODEL_ID,
      max_tokens: 4096,
      system: opts.system,
      messages: messages as never,
      tools: opts.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as never
      }))
    })

    if (opts.signal) {
      opts.signal.addEventListener('abort', () => stream.abort())
    }

    let assistantText = ''
    let toolUseId = ''
    let toolName = ''
    let toolInput = ''

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          assistantText += event.delta.text
          opts.onText(event.delta.text)
        } else if (event.delta.type === 'input_json_delta') {
          toolInput += event.delta.partial_json
        }
      }
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        toolUseId = event.content_block.id
        toolName = event.content_block.name
        toolInput = ''
      }
      if (event.type === 'content_block_stop' && toolUseId) {
        opts.onToolCall(toolName, toolInput)
      }
    }

    const toolCall = toolUseId ? { id: toolUseId, name: toolName, input: toolInput } : undefined
    return { text: assistantText, toolCall }
  }

  async complete(opts: { system: string; prompt: string; maxTokens: number }): Promise<string> {
    const msg = await this.client.messages.create({
      model: MODEL_ID,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: opts.prompt }]
    })
    const block = msg.content[0]
    return block.type === 'text' ? block.text.trim() : ''
  }
}
