import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// Marker string embedded in every hook command we write, used to identify and
// remove our own entries without touching user-configured hooks.
const MARKER = 'OVERWATCH_HOOK_PORT'

// Claude hooks: reads event JSON from stdin (piped by Claude) and POSTs it.
function makeClaudeHookCommand(eventType: string): string {
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Overwatch-Token: $OVERWATCH_HOOK_TOKEN" ' +
    '-H "X-Overwatch-Session-Id: $OVERWATCH_SESSION_ID" ' +
    '-H "X-Overwatch-Tab-Id: $OVERWATCH_TAB_ID" ' +
    `-H "X-Overwatch-Event-Type: ${eventType}" ` +
    '-d @- ' +
    `"http://127.0.0.1:$${MARKER}/hook" || true`
  )
}

// Kiro hooks: Kiro captures hook stdout and injects it as AI context, so we
// suppress output with -o /dev/null and use -d '{}' instead of reading stdin
// (Kiro does not pipe event data to the hook's stdin).
function makeKiroHookCommand(eventType: string): string {
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Overwatch-Token: $OVERWATCH_HOOK_TOKEN" ' +
    '-H "X-Overwatch-Session-Id: $OVERWATCH_SESSION_ID" ' +
    '-H "X-Overwatch-Tab-Id: $OVERWATCH_TAB_ID" ' +
    `-H "X-Overwatch-Event-Type: ${eventType}" ` +
    "-d '{}' " +
    `-o /dev/null "http://127.0.0.1:$${MARKER}/hook" || true`
  )
}

function isOurs(entry: unknown): boolean {
  return JSON.stringify(entry).includes(MARKER)
}

export function isClaudeCommand(command: string): boolean {
  const bin = command.split(/\s+/)[0].split('/').pop() ?? ''
  return bin === 'claude' || bin === 'claude-code'
}

export function isKiroCommand(command: string): boolean {
  const bin = command.split(/\s+/)[0].split('/').pop() ?? ''
  return bin === 'kiro' || bin === 'kiro-cli'
}

// ── Claude Code ──────────────────────────────────────────────────────────────

const CLAUDE_HOOKS_PATH = '.claude/settings.local.json'

// Claude uses the nested format: hooks[Event] = [{ hooks: [{ type, command }] }]
const CLAUDE_SPECS = [
  { hookKey: 'UserPromptSubmit', eventType: 'start' },
  { hookKey: 'Notification',     eventType: 'notification' },
  { hookKey: 'Stop',             eventType: 'stop' },
] as const

export function writeClaudeHooks(cwd: string): void {
  const filePath = join(cwd, CLAUDE_HOOKS_PATH)
  let config: Record<string, unknown> = {}
  try { config = JSON.parse(readFileSync(filePath, 'utf-8')) } catch {}

  const hooks = ((config.hooks ?? {}) as Record<string, unknown[]>)
  for (const { hookKey, eventType } of CLAUDE_SPECS) {
    const existing = Array.isArray(hooks[hookKey]) ? (hooks[hookKey] as unknown[]) : []
    const kept = existing.filter(e => !isOurs(e))
    hooks[hookKey] = [...kept, { hooks: [{ type: 'command', command: makeClaudeHookCommand(eventType) }] }]
  }
  config.hooks = hooks

  mkdirSync(join(cwd, '.claude'), { recursive: true })
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n')
}

export function removeClaudeHooks(cwd: string): void {
  const filePath = join(cwd, CLAUDE_HOOKS_PATH)
  let config: Record<string, unknown>
  try { config = JSON.parse(readFileSync(filePath, 'utf-8')) } catch { return }

  const hooks = ((config.hooks ?? {}) as Record<string, unknown[]>)
  let dirty = false
  for (const key of Object.keys(hooks)) {
    const before = hooks[key]
    hooks[key] = (before as unknown[]).filter(e => !isOurs(e))
    if (hooks[key].length !== before.length) dirty = true
    if (hooks[key].length === 0) delete hooks[key]
  }
  if (!dirty) return

  if (Object.keys(hooks).length === 0) delete config.hooks
  else config.hooks = hooks
  try { writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n') } catch {}
}

// ── Kiro ─────────────────────────────────────────────────────────────────────

const KIRO_HOOKS_PATH = '.kiro/agents/overwatch.json'

// Kiro uses the minimal format: hooks[event] = [{ command }]
const KIRO_SPECS = [
  { hookKey: 'userPromptSubmit', eventType: 'start' },
  { hookKey: 'preToolUse',       eventType: 'start' },
  { hookKey: 'postToolUse',      eventType: 'start' },
  { hookKey: 'stop',             eventType: 'stop' },
] as const

export function writeKiroHooks(cwd: string): void {
  const filePath = join(cwd, KIRO_HOOKS_PATH)
  let config: Record<string, unknown> = {}
  try { config = JSON.parse(readFileSync(filePath, 'utf-8')) } catch {}

  const hooks = ((config.hooks ?? {}) as Record<string, unknown[]>)
  for (const { hookKey, eventType } of KIRO_SPECS) {
    const existing = Array.isArray(hooks[hookKey]) ? (hooks[hookKey] as unknown[]) : []
    const kept = existing.filter(e => !isOurs(e))
    hooks[hookKey] = [...kept, { command: makeKiroHookCommand(eventType) }]
  }

  config.name = 'overwatch'
  config.description = 'Overwatch lifecycle hooks'
  config.hooks = hooks

  mkdirSync(join(cwd, '.kiro', 'agents'), { recursive: true })
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n')
}

export function removeKiroHooks(cwd: string): void {
  const filePath = join(cwd, KIRO_HOOKS_PATH)
  let config: Record<string, unknown>
  try { config = JSON.parse(readFileSync(filePath, 'utf-8')) } catch { return }

  const hooks = ((config.hooks ?? {}) as Record<string, unknown[]>)
  for (const key of Object.keys(hooks)) {
    hooks[key] = (hooks[key] as unknown[]).filter(e => !isOurs(e))
    if (hooks[key].length === 0) delete hooks[key]
  }
  try { writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n') } catch {}
}

// ── Notification classification (Claude only) ────────────────────────────────

export function isPermissionNotification(body: Record<string, unknown>): boolean {
  const message = typeof body.message === 'string' ? body.message : ''
  const title   = typeof body.title   === 'string' ? body.title   : ''
  return /permission|approval/i.test(message) || /permission|approval/i.test(title)
}
