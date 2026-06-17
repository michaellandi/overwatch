import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('overwatch', {
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    create: (goal: string, dir: string, agent?: string, initialPrompt?: string) => ipcRenderer.invoke('sessions:create', goal, dir, agent, initialPrompt),
    kill: (sessionId: string) => ipcRenderer.invoke('sessions:kill', sessionId),
    restart: (sessionId: string) => ipcRenderer.invoke('sessions:restart', sessionId),
    tell: (sessionId: string, message: string) => ipcRenderer.invoke('sessions:tell', sessionId, message),
    rename: (sessionId: string, name: string) => ipcRenderer.invoke('sessions:rename', sessionId, name),
    pickDir: () => ipcRenderer.invoke('sessions:pick-dir'),
    openWith: (app: string, dir: string) => ipcRenderer.invoke('sessions:open-with', app, dir),
    switchTab: (sessionId: string, tabId: string) => ipcRenderer.send('sessions:switch-tab', sessionId, tabId)
  },
  tabs: {
    add: (sessionId: string, type: string, command?: string) => ipcRenderer.invoke('tabs:add', sessionId, type, command),
    close: (sessionId: string, tabId: string) => ipcRenderer.invoke('tabs:close', sessionId, tabId)
  },
  terminal: {
    spawn: (tabId: string) => ipcRenderer.invoke('terminal:spawn', tabId),
    scrollback: (tabId: string) => ipcRenderer.invoke('terminal:scrollback', tabId),
    detach: (tabId: string) => ipcRenderer.send('terminal:detach', tabId),
    write: (tabId: string, data: string) => ipcRenderer.send('terminal:write', tabId, data),
    onData: (callback: (tabId: string, data: string) => void) => {
      const handler = (_e: unknown, tabId: string, data: string): void => callback(tabId, data)
      ipcRenderer.on('terminal:data', handler)
      return () => { ipcRenderer.removeListener('terminal:data', handler) }
    },
    onThinking: (callback: (sessionId: string, thinking: boolean) => void) => {
      const handler = (_e: unknown, sessionId: string, thinking: boolean): void => callback(sessionId, thinking)
      ipcRenderer.on('session:thinking', handler)
      return () => { ipcRenderer.removeListener('session:thinking', handler) }
    }
  },
  orchestrator: {
    onEvent: (callback: (event: unknown) => void) => {
      const handler = (_e: unknown, event: unknown): void => callback(event)
      ipcRenderer.on('orchestrator:event', handler)
      return () => { ipcRenderer.removeListener('orchestrator:event', handler) }
    },
    chat: (message: string) => ipcRenderer.invoke('overwatch:chat', message),
    cancel: (messageId: string) => ipcRenderer.invoke('overwatch:cancel', messageId),
    onChatStream: (callback: (chunk: string) => void) => {
      const handler = (_e: unknown, chunk: string): void => callback(chunk)
      ipcRenderer.on('overwatch:chat-stream', handler)
      return () => { ipcRenderer.removeListener('overwatch:chat-stream', handler) }
    },
    onChatDone: (callback: () => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('overwatch:chat-done', handler)
      return () => { ipcRenderer.removeListener('overwatch:chat-done', handler) }
    },
    onToolCall: (callback: (data: { name: string; input: string }) => void) => {
      const handler = (_e: unknown, data: { name: string; input: string }): void => callback(data)
      ipcRenderer.on('overwatch:tool-call', handler)
      return () => { ipcRenderer.removeListener('overwatch:tool-call', handler) }
    },
    onToolResult: (callback: (data: { name: string; result: string }) => void) => {
      const handler = (_e: unknown, data: { name: string; result: string }): void => callback(data)
      ipcRenderer.on('overwatch:tool-result', handler)
      return () => { ipcRenderer.removeListener('overwatch:tool-result', handler) }
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: { contextDir: string }) => ipcRenderer.invoke('settings:set', settings),
    testConnection: (providerSettings: { provider: 'bedrock' | 'anthropic'; anthropicApiKey?: string; awsRegion?: string; awsProfile?: string }) =>
      ipcRenderer.invoke('settings:test-connection', providerSettings)
  }
})
