import type { LLMProvider, ProviderSettings } from './types'
import { BedrockProvider } from './bedrock'
import { AnthropicProvider } from './anthropic'

export function getProvider(settings: ProviderSettings): LLMProvider {
  if (settings.provider === 'anthropic') {
    if (!settings.anthropicApiKey) throw new Error('Anthropic API key is required')
    return new AnthropicProvider(settings.anthropicApiKey)
  }
  return new BedrockProvider(settings.awsRegion ?? 'us-west-2', settings.awsProfile)
}

export type { LLMProvider, LLMMessage, LLMTool, LLMContentBlock, StreamResult, ProviderSettings } from './types'
