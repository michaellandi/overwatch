export interface Tab {
  id: string
  name: string
  type: 'agent' | 'terminal'
  command: string // e.g. "kiro-cli chat", "/bin/zsh"
  sessionRef?: string // agent's own session ID for resume
}

export interface Session {
  id: string
  name: string
  goal: string
  workingDir: string
  state: 'working' | 'blocked' | 'done'
  blockedReason?: 'idle' | 'stuck' | 'waiting'
  thinking?: boolean
  tabs: Tab[]
  activeTabId: string
  createdAt: number
  lastActivityAt: number
}

export interface Process {
  id: string
  sessionId: string
  type: 'agent' | 'terminal'
  pid?: number
  heartbeatAt: number
}

// Events flowing from sessions → orchestrator
export type SessionEvent =
  | { type: 'heartbeat'; sessionId: string; processId: string }
  | { type: 'blocked'; sessionId: string; reason: string; context: string }
  | { type: 'done'; sessionId: string; summary: string }
  | { type: 'output'; sessionId: string; processId: string; lines: string[] }
  | { type: 'error'; sessionId: string; processId: string; error: string }

// Commands flowing from orchestrator → sessions
export type OrchestratorCommand =
  | { type: 'message'; content: string }
  | { type: 'abort' }
  | { type: 'pause' }
  | { type: 'resume' }

// Notification from orchestrator → UI
export interface OrchestratorNotification {
  id: string
  timestamp: number
  sessionId?: string
  summary: string
  severity: 'info' | 'warning' | 'critical'
}
