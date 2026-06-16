export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string | LLMContentBlock[]
}

export type LLMContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export interface LLMTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface StreamResult {
  text: string
  toolCall?: { id: string; name: string; input: string }
}

export interface LLMProvider {
  /**
   * Streaming agentic turn: emits text chunks, notifies on tool call, resolves
   * with the full assistant text and optional tool call for the caller to handle.
   */
  stream(opts: {
    system: string
    messages: LLMMessage[]
    tools: LLMTool[]
    signal?: AbortSignal
    onText: (chunk: string) => void
    onToolCall: (name: string, input: string) => void
  }): Promise<StreamResult>

  /** One-shot non-streaming completion (used for summarizeBlocked). */
  complete(opts: {
    system: string
    prompt: string
    maxTokens: number
  }): Promise<string>
}

export interface ProviderSettings {
  provider: 'bedrock' | 'anthropic'
  anthropicApiKey?: string
  awsRegion?: string
  awsProfile?: string
}
