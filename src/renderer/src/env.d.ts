import type { Session, Tab } from '../shared/types'

declare global {
  interface Window {
    overwatch: {
      sessions: {
        list: () => Promise<Session[]>
        create: (goal: string, dir: string, agent?: string, initialPrompt?: string) => Promise<Session>
        kill: (sessionId: string) => Promise<void>
        restart: (sessionId: string) => Promise<Session>
        tell: (sessionId: string, message: string) => Promise<void>
        rename: (sessionId: string, name: string) => Promise<void>
        pickDir: () => Promise<string | null>
        openWith: (app: string, dir: string) => Promise<void>
        switchTab: (sessionId: string, tabId: string) => void
      }
      tabs: {
        add: (sessionId: string, type: 'agent' | 'terminal', command?: string) => Promise<Tab | null>
        close: (sessionId: string, tabId: string) => Promise<void>
      }
      terminal: {
        spawn: (tabId: string) => Promise<void>
        scrollback: (tabId: string) => Promise<string>
        detach: (tabId: string) => void
        write: (tabId: string, data: string) => void
        onData: (callback: (tabId: string, data: string) => void) => () => void
        onThinking: (callback: (sessionId: string, thinking: boolean) => void) => () => void
      }
      orchestrator: {
        onEvent: (callback: (event: unknown) => void) => () => void
        chat: (message: string) => Promise<string>
        cancel: (messageId: string) => Promise<boolean>
        onChatStream: (callback: (chunk: string) => void) => () => void
        onChatDone: (callback: () => void) => () => void
        onToolCall: (callback: (data: { name: string; input: string }) => void) => () => void
        onToolResult: (callback: (data: { name: string; result: string }) => void) => () => void
      }
      settings: {
        get: () => Promise<{ contextDir: string; enabledAgents?: string[]; enabledIntegrations?: string[]; mcpServers?: Array<{ name: string; command: string; args?: string[] }>; inactivityMinutes?: number; provider?: 'bedrock' | 'anthropic'; anthropicApiKey?: string; awsProfile?: string; awsRegion?: string; isFirstRun?: boolean }>
        set: (settings: { contextDir: string; enabledAgents?: string[]; enabledIntegrations?: string[]; mcpServers?: Array<{ name: string; command: string; args?: string[] }>; inactivityMinutes?: number; provider?: 'bedrock' | 'anthropic'; anthropicApiKey?: string; awsProfile?: string; awsRegion?: string }) => Promise<boolean>
        testConnection: (providerSettings: { provider: 'bedrock' | 'anthropic'; anthropicApiKey?: string; awsRegion?: string; awsProfile?: string }) => Promise<{ ok: true } | { ok: false; error: string }>
      }
    }
  }
}

export {}
