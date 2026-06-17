import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime'
import { fromIni } from '@aws-sdk/credential-providers'
import type { LLMProvider, LLMMessage, LLMContentBlock, LLMTool, StreamResult } from './types'

const MODEL_ID = 'us.anthropic.claude-sonnet-4-6'

// Bedrock's ConverseCommand expects content blocks keyed by block type
// (e.g. { toolUse: {...} }), not our internal Anthropic-shaped
// { type: 'tool_use', ... } blocks — translate before sending.
function toBedrockContent(block: LLMContentBlock): Record<string, unknown> {
  if (block.type === 'text') return { text: block.text }
  if (block.type === 'tool_use') return { toolUse: { toolUseId: block.id, name: block.name, input: block.input } }
  return { toolResult: { toolUseId: block.tool_use_id, content: [{ text: block.content }] } }
}

export class BedrockProvider implements LLMProvider {
  private client: BedrockRuntimeClient

  constructor(region = 'us-west-2', profile?: string) {
    const opts: ConstructorParameters<typeof BedrockRuntimeClient>[0] = { region }
    if (profile && profile !== 'default') opts.credentials = fromIni({ profile })
    this.client = new BedrockRuntimeClient(opts)
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
        ? [{ text: m.content }]
        : m.content.map(toBedrockContent)
    }))

    const response = await this.client.send(new ConverseStreamCommand({
      modelId: MODEL_ID,
      system: [{ text: opts.system }],
      messages: messages as never,
      toolConfig: {
        tools: opts.tools.map(t => ({
          toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema } }
        }))
      } as never
    }), { abortSignal: opts.signal })

    let assistantText = ''
    let toolUseId = ''
    let toolName = ''
    let toolInput = ''

    if (response.stream) {
      for await (const event of response.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          const chunk = event.contentBlockDelta.delta.text
          assistantText += chunk
          opts.onText(chunk)
        }
        if (event.contentBlockStart?.start?.toolUse) {
          toolUseId = event.contentBlockStart.start.toolUse.toolUseId ?? ''
          toolName = event.contentBlockStart.start.toolUse.name ?? ''
          toolInput = ''
        }
        if (event.contentBlockDelta?.delta?.toolUse) {
          toolInput += event.contentBlockDelta.delta.toolUse.input ?? ''
        }
        if (event.contentBlockStop && toolUseId) {
          opts.onToolCall(toolName, toolInput)
        }
      }
    }

    const toolCall = toolUseId ? { id: toolUseId, name: toolName, input: toolInput } : undefined
    return { text: assistantText, toolCall }
  }

  async complete(opts: { system: string; prompt: string; maxTokens: number }): Promise<string> {
    const resp = await this.client.send(new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: opts.system }],
      messages: [{ role: 'user', content: [{ text: opts.prompt }] }],
      inferenceConfig: { maxTokens: opts.maxTokens }
    }))
    const text = (resp.output?.message?.content?.[0] as { text?: string })?.text
    return text?.trim() ?? ''
  }
}
