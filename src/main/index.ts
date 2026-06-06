import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { Orchestrator, configureBedrock } from './orchestrator'
import { startMcpServer } from './mcp-server'

// Resolve user's full PATH from their login shell (bundled apps don't inherit it)
try {
  const shell = process.env.SHELL ?? '/bin/zsh'
  const userPath = execSync(`${shell} -ilc 'echo $PATH'`, { encoding: 'utf-8' }).trim()
  if (userPath) process.env.PATH = userPath
} catch { /* keep existing PATH */ }
import { OverwatchAgent } from './strands-agent'

// Required for unsigned Electron apps in development on macOS
if (!app.isPackaged) {
  app.commandLine.appendSwitch('no-sandbox')
}

let mainWindow: BrowserWindow | null = null
const orchestrator = new Orchestrator()
const agent = new OverwatchAgent()

function getBoundsPath(): string {
  return join(app.getPath('userData'), 'window-bounds.json')
}

function loadBounds(): { x?: number; y?: number; width: number; height: number } {
  try {
    return JSON.parse(readFileSync(getBoundsPath(), 'utf-8'))
  } catch {
    return { width: 1400, height: 900 }
  }
}

function saveBounds(): void {
  if (!mainWindow) return
  try {
    const bounds = mainWindow.getBounds()
    mkdirSync(join(getBoundsPath(), '..'), { recursive: true })
    writeFileSync(getBoundsPath(), JSON.stringify(bounds))
  } catch { /* ignore */ }
}

function createWindow(): void {
  const bounds = loadBounds()
  mainWindow = new BrowserWindow({
    ...bounds,
    title: 'Overwatch',
    icon: join(__dirname, '../../resources/logo.png'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.on('close', saveBounds)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Forward renderer console to main process stdout for debugging
  mainWindow.webContents.on('console-message', (_e, _level, message) => {
    console.log('[renderer]', message)
  })
}

app.whenReady().then(() => {
  createWindow()
  orchestrator.start()
  startMcpServer(orchestrator)

  // IPC handlers
  ipcMain.handle('sessions:list', () => orchestrator.getSessions())
  ipcMain.handle('sessions:create', (_e, goal: string, dir: string, agentType?: string, initialPrompt?: string) => {
    console.log('[overwatch] Creating session:', goal, dir, agentType)
    let initialTab: { type: 'agent' | 'terminal'; command?: string } | undefined
    if (agentType === 'kiro') initialTab = { type: 'agent', command: 'kiro-cli chat' }
    else if (agentType === 'claude') initialTab = { type: 'agent', command: 'claude' }
    else if (agentType === 'terminal') initialTab = { type: 'terminal' }
    const session = orchestrator.createSession(goal, dir, initialTab)

    if (initialPrompt && session.tabs[0]) {
      setTimeout(() => {
        const pty = orchestrator.getPty(session.tabs[0].id)
        if (pty) pty.write(initialPrompt + '\r')
      }, 2000)
    }

    return { ...session }
  })
  ipcMain.handle('sessions:kill', (_e, sessionId: string) =>
    orchestrator.killSession(sessionId)
  )
  ipcMain.handle('sessions:restart', (_e, sessionId: string) =>
    orchestrator.restartSession(sessionId)
  )
  ipcMain.handle('sessions:tell', (_e, sessionId: string, message: string) =>
    orchestrator.tellSession(sessionId, message)
  )
  ipcMain.handle('sessions:rename', (_e, sessionId: string, name: string) =>
    orchestrator.renameSession(sessionId, name)
  )
  ipcMain.on('sessions:switch-tab', (_e, sessionId: string, tabId: string) => {
    orchestrator.switchTab(sessionId, tabId)
  })
  ipcMain.handle('sessions:pick-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select working directory'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('sessions:open-with', (_e, app: string, dir: string) => {
    const { exec } = require('child_process')
    const resolvedDir = dir || loadSettings().contextDir
    const commands: Record<string, string> = {
      vscode: `code "${resolvedDir}"`,
      terminal: `open -a Terminal "${resolvedDir}"`,
      iterm: `open -a iTerm "${resolvedDir}"`,
      finder: `open "${resolvedDir}"`,
      obsidian: `open -a Obsidian "${resolvedDir}"`
    }
    const cmd = commands[app]
    if (cmd) exec(cmd)
  })

  const settingsPath = join(app.getPath('userData'), 'settings.json')

  interface McpServerConfig { name: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> }
  interface Settings { contextDir: string; mcpServers: McpServerConfig[]; inactivityMinutes?: number; awsProfile?: string; awsRegion?: string }

  const DEFAULT_MCP_SERVERS: McpServerConfig[] = []

  function loadSettings(): Settings {
    try {
      const s = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      return { ...s, mcpServers: s.mcpServers ?? [] }
    }
    catch { return { contextDir: join(app.getPath('home'), 'Desktop/brain'), mcpServers: DEFAULT_MCP_SERVERS } }
  }

  const isFirstRun = !require('fs').existsSync(settingsPath)

  function saveSettings(settings: Settings): void {
    mkdirSync(join(settingsPath, '..'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  }

  const settings = loadSettings()
  mkdirSync(settings.contextDir, { recursive: true })
  if (settings.inactivityMinutes) orchestrator.setInactivityTimeout(settings.inactivityMinutes)
  const region = settings.awsRegion ?? 'us-west-2'
  const profile = settings.awsProfile
  agent.configure(region, profile)
  configureBedrock(region, profile)
  agent.start(orchestrator, settings.contextDir)
  orchestrator.onEvent((summary, sessionId, tabId) => agent.injectEvent(summary, sessionId, tabId))
  if (settings.mcpServers?.length > 0) {
    agent.connectMcpServers(settings.mcpServers)
  }

  ipcMain.handle('overwatch:chat', async (_e, message: string) => {
    return agent.ask(message)
  })
  ipcMain.handle('overwatch:cancel', () => {
    agent.stop()
    return true
  })

  ipcMain.handle('settings:get', () => ({ ...loadSettings(), isFirstRun }))
  ipcMain.handle('settings:set', (_e, newSettings: Settings) => {
    try {
      console.log('[overwatch] settings:set called, awsProfile:', newSettings.awsProfile, 'awsRegion:', newSettings.awsRegion)
      saveSettings(newSettings)
      mkdirSync(newSettings.contextDir, { recursive: true })
      if (newSettings.inactivityMinutes) orchestrator.setInactivityTimeout(newSettings.inactivityMinutes)
      const r = newSettings.awsRegion ?? 'us-west-2'
      const p = newSettings.awsProfile
      agent.configure(r, p)
      configureBedrock(r, p)
      agent.start(orchestrator, newSettings.contextDir)
      if (newSettings.mcpServers?.length > 0) {
        agent.connectMcpServers(newSettings.mcpServers)
      }
      return true
    } catch (err) {
      console.error('[overwatch] settings:set error:', err)
      return false
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  orchestrator.stop()
  if (process.platform !== 'darwin') app.quit()
})
