import { app, BrowserWindow, ipcMain } from 'electron'
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Session, Tab } from '../shared/types'
import { RingBuffer, StuckDetector } from './stuck-detector'
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { fromIni } from '@aws-sdk/credential-providers'

let summarizeClient: BedrockRuntimeClient = new BedrockRuntimeClient({ region: 'us-west-2' })

export function configureBedrock(region: string, profile?: string): void {
  const p = profile ?? 'default'
  summarizeClient = new BedrockRuntimeClient({ region, credentials: fromIni({ profile: p }) })
}

async function summarizeBlocked(sessionName: string, lastLines: string[]): Promise<string> {
  try {
    const resp = await summarizeClient.send(new ConverseCommand({
      modelId: 'us.anthropic.claude-sonnet-4-6',
      messages: [{ role: 'user', content: [{ text: `In 10 words or less, summarize why this coding agent session is blocked. No markdown formatting. Plain text only. Here's the last output:\n${lastLines.join('\n')}` }] }],
      inferenceConfig: { maxTokens: 50 }
    }))
    const text = (resp.output?.message?.content?.[0] as { text?: string })?.text
    return text?.trim() ?? 'waiting for input'
  } catch (err) {
    console.log('[summarize] error:', err)
    return 'waiting for input'
  }
}

let HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes default, configurable in settings
const CHECK_INTERVAL_MS = 5_000
const RING_BUFFER_SIZE = 100

interface PersistedState {
  sessions: Session[]
}

export class Orchestrator {
  private sessions = new Map<string, Session>()
  private ptys = new Map<string, IPty>() // keyed by tabId
  private buffers = new Map<string, RingBuffer>() // keyed by tabId
  private scrollback = new Map<string, string[]>() // raw output chunks per tab

  setInactivityTimeout(minutes: number): void {
    HEARTBEAT_TIMEOUT_MS = minutes * 60 * 1000
  }

  private findSession(idOrName: string): Session | undefined {
    let session = this.sessions.get(idOrName)
    if (!session) {
      for (const s of this.sessions.values()) {
        if (s.name === idOrName) { session = s; break }
      }
    }
    return session
  }
  private earlyOutput = new Map<string, string[]>() // keyed by tabId
  private rendererReady = new Set<string>() // tabIds whose renderer has connected
  private detector = new StuckDetector()
  private checkInterval: NodeJS.Timeout | null = null
  private statePath: string = ''

  start(): void {
    this.statePath = join(app.getPath('userData'), 'state.json')
    this.load()
    // Skip restored sessions for 15s to avoid false positives during initialization
    const restoredIds = new Set([...this.sessions.keys()])
    setTimeout(() => restoredIds.clear(), 15_000)
    this.checkInterval = setInterval(() => this.checkHealth(restoredIds), CHECK_INTERVAL_MS)

    // tabId-based terminal management
    ipcMain.handle('terminal:spawn', (_e, tabId: string) => {
      this.rendererReady.add(tabId)
      const early = this.earlyOutput.get(tabId)
      if (early && early.length > 0) {
        const win = BrowserWindow.getAllWindows()[0]
        for (const chunk of early) {
          win?.webContents.send('terminal:data', tabId, chunk)
        }
        this.earlyOutput.delete(tabId)
      }
      if (!this.ptys.has(tabId)) {
        this.spawnTab(tabId)
      }
    })

    ipcMain.on('terminal:write', (_e, tabId: string, data: string) => {
      this.ptys.get(tabId)?.write(data)
    })

    ipcMain.handle('terminal:scrollback', (_e, tabId: string) => {
      // Only show scrollback for plain terminals, not agents (agents have their own resume)
      for (const session of this.sessions.values()) {
        const tab = session.tabs.find(t => t.id === tabId)
        if (tab && tab.type === 'agent') return ''
      }
      return this.loadScrollback(tabId)
    })

    // Tab management
    ipcMain.handle('tabs:add', (_e, sessionId: string, type: 'agent' | 'terminal', command?: string) => {
      return this.addTab(sessionId, type, command)
    })

    ipcMain.handle('tabs:close', (_e, sessionId: string, tabId: string) => {
      this.closeTab(sessionId, tabId)
    })
  }

  stop(): void {
    if (this.checkInterval) clearInterval(this.checkInterval)
    for (const [tabId] of this.ptys) this.saveScrollback(tabId)
    for (const pty of this.ptys.values()) pty.kill()
    this.save()
  }

  getSessions(): Session[] {
    return [...this.sessions.values()]
  }

  createSession(goal: string, dir: string, initialTab?: { type: 'agent' | 'terminal'; command?: string }): Session {
    const id = crypto.randomUUID()
    const name = goal.slice(0, 30).replace(/\s+/g, '-').toLowerCase()
    const resolvedDir = dir === '~' ? (process.env.HOME ?? '/') : dir.replace(/^~/, process.env.HOME ?? '')

    // Validate directory exists
    try {
      const stat = require('fs').statSync(resolvedDir)
      if (!stat.isDirectory()) throw new Error('Not a directory')
    } catch {
      throw new Error(`Directory does not exist: ${resolvedDir}`)
    }

    const tabType = initialTab?.type ?? 'terminal'
    const tabCommand = initialTab?.command ?? (process.env.SHELL ?? '/bin/zsh')
    const tabName = tabType === 'agent' ? tabCommand.split('/').pop()?.split(' ')[0] ?? 'agent' : 'terminal'
    const tab: Tab = {
      id: crypto.randomUUID(),
      name: tabName,
      type: tabType,
      command: tabCommand
    }

    const session: Session = {
      id,
      name,
      goal,
      workingDir: resolvedDir,
      state: 'working',
      tabs: [tab],
      activeTabId: tab.id,
      createdAt: Date.now(),
      lastActivityAt: Date.now()
    }
    this.sessions.set(id, session)
    this.buffers.set(tab.id, new RingBuffer(RING_BUFFER_SIZE))
    this.save()
    this.spawnTab(tab.id)
    this.notify({ type: 'session:created', sessionId: id, summary: `Session "${name}" created` })
    return session
  }

  addTab(sessionId: string, type: 'agent' | 'terminal', command?: string): Tab | null {
    const session = this.findSession(sessionId)
    if (!session) return null

    const cmd = command ?? (type === 'terminal' ? (process.env.SHELL ?? '/bin/zsh') : 'kiro-cli chat')
    const name = type === 'agent' ? cmd.split('/').pop()?.split(' ')[0] ?? 'agent' : 'terminal'
    const tab: Tab = {
      id: crypto.randomUUID(),
      name,
      type,
      command: cmd
    }

    session.tabs.push(tab)
    session.activeTabId = tab.id
    this.buffers.set(tab.id, new RingBuffer(RING_BUFFER_SIZE))
    this.save()
    this.spawnTab(tab.id)
    return tab
  }

  closeTab(sessionId: string, tabId: string): void {
    const session = this.findSession(sessionId)
    if (!session) return

    const pty = this.ptys.get(tabId)
    if (pty) { pty.kill(); this.ptys.delete(tabId) }
    this.buffers.delete(tabId)
    this.earlyOutput.delete(tabId)
    this.rendererReady.delete(tabId)

    session.tabs = session.tabs.filter(t => t.id !== tabId)
    if (session.activeTabId === tabId) {
      session.activeTabId = session.tabs[0]?.id ?? ''
    }
    if (session.tabs.length === 0) {
      session.state = 'done'
    }
    this.save()
  }

  killSession(sessionId: string): void {
    const session = this.findSession(sessionId)
    if (session) {
      for (const tab of session.tabs) {
        const pty = this.ptys.get(tab.id)
        if (pty) { pty.kill(); this.ptys.delete(tab.id) }
        this.buffers.delete(tab.id)
        this.earlyOutput.delete(tab.id)
        this.rendererReady.delete(tab.id)
      }
    }
    const name = session?.name ?? sessionId.slice(0, 8)
    this.sessions.delete(sessionId)
    this.save()
    this.notify({ type: 'session:killed', sessionId, summary: `Session "${name}" killed` })
  }

  restartSession(sessionId: string): Session | null {
    const session = this.findSession(sessionId)
    if (!session) return null

    for (const tab of session.tabs) {
      const pty = this.ptys.get(tab.id)
      if (pty) { pty.kill(); this.ptys.delete(tab.id) }
      this.rendererReady.delete(tab.id)
      this.earlyOutput.delete(tab.id)
    }

    session.state = 'working'
    session.lastActivityAt = Date.now()
    this.save()
    // Re-spawn all tabs
    for (const tab of session.tabs) {
      this.spawnTab(tab.id)
    }
    this.notify({ type: 'session:restarted', sessionId, summary: `Session "${session.name}" restarted` })
    return session
  }

  tellSession(sessionId: string, message: string, tabId?: string): void {
    const session = this.findSession(sessionId)
    if (!session) return
    const target = tabId ?? session.activeTabId
    const pty = this.ptys.get(target)
    if (pty) pty.write(message + '\r')
  }

  getPty(tabId: string): IPty | undefined {
    return this.ptys.get(tabId)
  }

  switchTab(sessionId: string, tabId: string): void {
    const session = this.findSession(sessionId)
    if (session) {
      session.activeTabId = tabId
      this.save()
    }
  }

  renameSession(sessionId: string, name: string): void {
    const session = this.findSession(sessionId)
    if (session) {
      session.name = name
      this.save()
    }
  }

  peekSession(sessionId: string, lines: number): string {
    const session = this.findSession(sessionId)
    if (!session) return ''
    const buffer = this.buffers.get(session.activeTabId)
    if (!buffer) return ''
    return buffer.last(lines).join('\n')
  }

  peekTab(tabId: string, lines: number): string {
    const buffer = this.buffers.get(tabId)
    if (buffer) {
      const content = buffer.last(lines).join('\n')
      if (content) return content
    }
    // Fall back to saved scrollback
    const raw = this.loadScrollback(tabId)
    if (!raw) return ''
    return raw.split(/\r?\n/).filter(l => l.trim()).slice(-lines).join('\n')
  }

  handleMessage(message: string): string {
    const sessions = this.getSessions()
    const lower = message.toLowerCase()

    if (lower.includes('status') || lower.includes('what') || lower.includes('how')) {
      const running = sessions.filter(s => s.state === 'working')
      const stuck = sessions.filter(s => s.state === 'blocked')
      const parts = [`${sessions.length} sessions total.`]
      if (running.length) parts.push(`Running: ${running.map(s => s.name).join(', ')}`)
      if (stuck.length) parts.push(`Stuck: ${stuck.map(s => s.name).join(', ')}`)
      if (sessions.length === 0) parts.push('No active sessions.')
      return parts.join('\n')
    }

    if (lower.includes('stuck')) {
      const stuck = sessions.filter(s => s.state === 'blocked')
      if (stuck.length === 0) return 'No sessions are currently stuck.'
      return stuck.map(s => `${s.name}: stuck`).join('\n')
    }

    if (lower.includes('peek') || lower.includes('show')) {
      const match = sessions.find(s => lower.includes(s.name))
      if (match) return this.peekSession(match.id, 20) || '(no output yet)'
      return `Couldn't find a matching session. Active: ${sessions.map(s => s.name).join(', ')}`
    }

    return `I have ${sessions.length} sessions. Ask me about their status, what's stuck, or peek at a specific session.`
  }

  private spawnTab(tabId: string): void {
    let cwd = process.env.HOME ?? '/'
    let command = process.env.SHELL ?? '/bin/zsh'
    let args: string[] = []

    for (const session of this.sessions.values()) {
      const tab = session.tabs.find(t => t.id === tabId)
      if (tab) {
        cwd = session.workingDir
        const parts = tab.command.split(/\s+/)
        command = parts[0]
        args = parts.slice(1)

        // If agent has been run before in this dir, add resume flag
        if (tab.type === 'agent' && tab.sessionRef) {
          if (tab.command.startsWith('kiro')) {
            args.push('--resume')
          } else if (tab.command.startsWith('claude')) {
            args = args.filter(a => a !== '-c' && a !== '--continue')
            args.push('--continue')
          }
        }
        // For claude, always set a name based on tab ID for discoverability
        if (tab.type === 'agent' && tab.command.startsWith('claude') && !tab.sessionRef) {
          args.push('-n', `overwatch-${tabId.slice(0, 8)}`)
        }
        break
      }
    }

    const pty = spawn(command, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: { ...process.env, SHELL: process.env.SHELL ?? '/bin/zsh' }
    })

    // Capture kiro session ID from output
    let capturedSessionId = false
    pty.onData(data => {
      this.onTabActivity(tabId, data)

      // Accumulate scrollback
      if (!this.scrollback.has(tabId)) this.scrollback.set(tabId, [])
      this.scrollback.get(tabId)!.push(data)

      // Mark agent tabs as resumable once they produce output
      if (!capturedSessionId) {
        for (const session of this.sessions.values()) {
          const tab = session.tabs.find(t => t.id === tabId)
          if (tab?.type === 'agent' && !tab.sessionRef) {
            tab.sessionRef = 'active'
            capturedSessionId = true
            this.save()
          }
        }
      }

      const win = BrowserWindow.getAllWindows()[0]
      if (this.rendererReady.has(tabId)) {
        win?.webContents.send('terminal:data', tabId, data)
      } else {
        if (!this.earlyOutput.has(tabId)) this.earlyOutput.set(tabId, [])
        this.earlyOutput.get(tabId)!.push(data)
      }
    })

    pty.onExit(({ exitCode }) => {
      console.log(`[pty] tab ${tabId} exited with code ${exitCode}`)
      this.saveScrollback(tabId)
      this.ptys.delete(tabId)
      // Check if session has any remaining live PTYs
      for (const session of this.sessions.values()) {
        if (session.tabs.some(t => t.id === tabId)) {
          const hasLivePty = session.tabs.some(t => this.ptys.has(t.id))
          if (!hasLivePty) {
            session.state = 'done'
            this.save()
          }
          break
        }
      }
    })

    this.ptys.set(tabId, pty)
  }

  private onTabActivity(tabId: string, data: string): void {
    // Find the parent session
    for (const session of this.sessions.values()) {
      if (session.tabs.some(t => t.id === tabId)) {
        session.lastActivityAt = Date.now()
        if (session.state === 'blocked') {
          session.state = 'working'
          this.notify({ type: 'session:resumed', sessionId: session.id, summary: `Session "${session.name}" resumed` })
        }
        break
      }
    }

    const buffer = this.buffers.get(tabId)
    if (buffer) {
      // Strip ANSI escape codes for clean pattern matching
      const clean = data.replace(/\x1b\[[?!>]?[0-9;]*[a-zA-Z~]/g, '').replace(/\x1b[()][0-9A-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
      const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0)
      for (const line of lines) buffer.push(line)

      // Track thinking state - only emit on transitions
      for (const session of this.sessions.values()) {
        const tab = session.tabs.find(t => t.id === tabId)
        if (tab) {
          const isThinking = clean.includes('Thinking') || clean.includes('thinking')
          if (isThinking && !session.thinking) {
            session.thinking = true
            const win = BrowserWindow.getAllWindows()[0]
            win?.webContents.send('session:thinking', session.id, true)
          } else if (!isThinking && session.thinking) {
            // Delay clearing thinking to avoid flicker
            setTimeout(() => {
              if (session.thinking) {
                session.thinking = false
                const win = BrowserWindow.getAllWindows()[0]
                win?.webContents.send('session:thinking', session.id, false)
              }
            }, 2000)
          }
          break
        }
      }
    }
  }

  private checkHealth(skipIds?: Set<string>): void {
    const now = Date.now()
    for (const session of this.sessions.values()) {
      if (session.state === 'done') continue
      if (skipIds?.has(session.id)) continue

      if (now - session.lastActivityAt > HEARTBEAT_TIMEOUT_MS && session.state !== 'blocked') {
        session.state = 'blocked'
        session.blockedReason = 'idle'
        this.save()
        this.notify({
          type: 'session:idle',
          sessionId: session.id,
          summary: `Session "${session.name}" — no activity for ${Math.round(HEARTBEAT_TIMEOUT_MS / 1000)}s`
        })
        continue
      }

      if (session.state === 'working') {
        for (const tab of session.tabs) {
          const buffer = this.buffers.get(tab.id)
          if (buffer) {
            const result = this.detector.analyze(buffer)
            if (result.stuck) {
              session.state = 'blocked'
              session.blockedReason = 'stuck'
              this.save()
              this.notify({
                type: 'session:stuck',
                sessionId: session.id,
                tabId: tab.id,
                summary: `⚡ **${session.name}** [${tab.name}] — ${result.reason}`
              })
              break
            }
            if (result.waiting) {
              session.state = 'blocked'
              session.blockedReason = 'waiting'
              this.save()
              const lastLines = buffer.last(30).filter(l => !/^[─━─\-=]{5,}$/.test(l.trim()))
              summarizeBlocked(session.name, lastLines).then(summary => {
                this.notify({
                  type: 'session:waiting',
                  sessionId: session.id,
                  tabId: tab.id,
                  summary: `⚡ **${session.name}** [${tab.name}] — ${summary}`
                })
              })
              break
            }
          }
        }
      }
    }
  }

  private eventListener?: (summary: string, sessionId?: string, tabId?: string) => void

  onEvent(listener: (summary: string, sessionId?: string, tabId?: string) => void): void {
    this.eventListener = listener
  }

  private notify(event: { type: string; sessionId?: string; tabId?: string; summary: string }): void {
    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send('orchestrator:event', event)
    // Only inject blocked events into agent history
    if (event.type === 'session:stuck' || event.type === 'session:waiting' || event.type === 'session:idle') {
      this.eventListener?.(event.summary, event.sessionId, event.tabId)
    }
  }

  private save(): void {
    const state: PersistedState = { sessions: [...this.sessions.values()] }
    try {
      mkdirSync(join(this.statePath, '..'), { recursive: true })
      writeFileSync(this.statePath, JSON.stringify(state, null, 2))
    } catch { /* ignore write errors */ }
  }

  private load(): void {
    try {
      const raw = readFileSync(this.statePath, 'utf-8')
      const state: PersistedState = JSON.parse(raw)
      const toResume: Session[] = []

      for (const session of state.sessions) {
        // Migrate old sessions that lack tabs
        if (!session.tabs) {
          const tabId = crypto.randomUUID()
          session.tabs = [{ id: tabId, name: 'terminal', type: 'terminal', command: process.env.SHELL ?? '/bin/zsh' }]
          session.activeTabId = tabId
        }

        // Mark agent tabs as resumable (they have conversation history in their cwd)
        for (const tab of session.tabs) {
          if (tab.type === 'agent' && !tab.sessionRef) {
            tab.sessionRef = 'active'
          }
        }

        // Sessions that were active and have resumable agent tabs should be restarted
        const wasActive = session.state === 'working' || session.state === 'blocked'
        const hasTabs = session.tabs.length > 0

        if (wasActive || hasTabs) {
          const idleTime = Date.now() - session.lastActivityAt
          if (idleTime > HEARTBEAT_TIMEOUT_MS) {
            session.state = 'blocked'
            session.blockedReason = 'idle'
          } else {
            session.state = 'working'
          }
          toResume.push(session)
        } else {
          session.state = 'done'
        }

        this.sessions.set(session.id, session)
      }

      // Spawn PTYs for resumable sessions after all are registered
      for (const session of toResume) {
        for (const tab of session.tabs) {
          this.buffers.set(tab.id, new RingBuffer(RING_BUFFER_SIZE))
          this.spawnTab(tab.id)
        }
      }
    } catch { /* no persisted state, fresh start */ }
  }

  private scrollbackDir(): string {
    return join(this.statePath, '..', 'scrollback')
  }

  private saveScrollback(tabId: string): void {
    const chunks = this.scrollback.get(tabId)
    if (!chunks || chunks.length === 0) return
    try {
      const dir = this.scrollbackDir()
      mkdirSync(dir, { recursive: true })
      let content = chunks.join('')
      if (content.length > 50_000) content = content.slice(-50_000)
      writeFileSync(join(dir, `${tabId}.raw`), content)
    } catch { /* ignore */ }
  }

  private loadScrollback(tabId: string): string {
    try {
      return readFileSync(join(this.scrollbackDir(), `${tabId}.raw`), 'utf-8')
    } catch {
      return ''
    }
  }
}
