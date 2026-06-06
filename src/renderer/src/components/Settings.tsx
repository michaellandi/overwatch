import React, { useState, useEffect } from 'react'
import { useTheme } from '../ThemeProvider'
import { themes } from '../themes'

interface Props {
  open: boolean
  onClose: () => void
}

type Tab = 'general' | 'agents' | 'integrations' | 'mcp'

const DEFAULT_AGENTS = [
  { id: 'kiro', label: 'Kiro', desc: 'kiro-cli chat' },
  { id: 'claude', label: 'Claude', desc: 'claude code' },
  { id: 'terminal', label: 'Terminal', desc: 'Plain shell' }
]

const DEFAULT_INTEGRATIONS = [
  { id: 'vscode', label: 'VS Code', desc: 'Open folder in VS Code' },
  { id: 'terminal', label: 'Terminal', desc: 'Open macOS Terminal' },
  { id: 'iterm', label: 'iTerm2', desc: 'Open in iTerm2' },
  { id: 'finder', label: 'Finder', desc: 'Show in Finder' },
  { id: 'obsidian', label: 'Obsidian', desc: 'Open in Obsidian' }
]

export function Settings({ open, onClose }: Props): React.ReactElement | null {
  const [tab, setTab] = useState<Tab>('general')
  const [contextDir, setContextDir] = useState('')
  const [enabledAgents, setEnabledAgents] = useState<string[]>(['kiro', 'claude', 'terminal'])
  const [enabledIntegrations, setEnabledIntegrations] = useState<string[]>(['vscode', 'terminal', 'finder', 'obsidian'])
  const [inactivityMinutes, setInactivityMinutes] = useState(5)
  const [awsProfile, setAwsProfile] = useState('default')
  const [awsRegion, setAwsRegion] = useState('us-west-2')
  const { themeId, setThemeId } = useTheme()

  const [mcpServers, setMcpServers] = useState<Array<{ name: string; command: string; args?: string[] }>>([])
  const [newMcpName, setNewMcpName] = useState('')
  const [newMcpCommand, setNewMcpCommand] = useState('')
  useEffect(() => {
    if (open) {
      window.overwatch.settings.get().then(s => {
        setContextDir(s.contextDir)
        if (s.enabledAgents) setEnabledAgents(s.enabledAgents)
        if (s.enabledIntegrations) setEnabledIntegrations(s.enabledIntegrations)
        if (s.mcpServers) setMcpServers(s.mcpServers)
        if (s.inactivityMinutes) setInactivityMinutes(s.inactivityMinutes)
        if (s.awsProfile) setAwsProfile(s.awsProfile)
        if (s.awsRegion) setAwsRegion(s.awsRegion)
      })
    }
  }, [open])

  if (!open) return null

  const save = async (): Promise<void> => {
    const current = await window.overwatch.settings.get()
    await window.overwatch.settings.set({ ...current, contextDir, enabledAgents, enabledIntegrations, mcpServers, inactivityMinutes, awsProfile, awsRegion })
    onClose()
  }

  const pickDir = async (): Promise<void> => {
    const picked = await window.overwatch.sessions.pickDir()
    if (picked) setContextDir(picked)
  }

  const toggleAgent = (id: string): void => {
    setEnabledAgents(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id])
  }

  const toggleIntegration = (id: string): void => {
    setEnabledIntegrations(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id])
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-tabs">
          <button className={`settings-tab ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>General</button>
          <button className={`settings-tab ${tab === 'agents' ? 'active' : ''}`} onClick={() => setTab('agents')}>Agents</button>
          <button className={`settings-tab ${tab === 'integrations' ? 'active' : ''}`} onClick={() => setTab('integrations')}>Open With</button>
          <button className={`settings-tab ${tab === 'mcp' ? 'active' : ''}`} onClick={() => setTab('mcp')}>MCP</button>
        </div>

        {tab === 'general' && (
          <div className="settings-content">
            <div className="settings-field">
              <label>Theme</label>
              <select className="theme-selector" value={themeId} onChange={e => setThemeId(e.target.value)}>
                {Object.entries(themes).map(([id, t]) => (
                  <option key={id} value={id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="settings-field">
              <label>Context Folder</label>
              <p className="settings-help">Working directory for the Overwatch agent. Place an AGENTS.md here to customize behavior.</p>
              <div className="settings-dir-row">
                <input type="text" value={contextDir} onChange={e => setContextDir(e.target.value)} />
                <button onClick={pickDir}>Browse</button>
              </div>
            </div>
            <div className="settings-field">
              <label>Inactivity Timeout (minutes)</label>
              <input type="number" min={1} max={60} value={inactivityMinutes} onChange={e => setInactivityMinutes(Number(e.target.value))} />
            </div>
            <div className="settings-field">
              <label>AWS Profile</label>
              <input type="text" value={awsProfile} onChange={e => setAwsProfile(e.target.value)} placeholder="default" />
            </div>
            <div className="settings-field">
              <label>AWS Region</label>
              <select value={awsRegion} onChange={e => setAwsRegion(e.target.value)}>
                <option value="us-east-1">us-east-1</option>
                <option value="us-west-2">us-west-2</option>
                <option value="eu-west-1">eu-west-1</option>
                <option value="eu-central-1">eu-central-1</option>
                <option value="ap-northeast-1">ap-northeast-1</option>
                <option value="ap-southeast-1">ap-southeast-1</option>
              </select>
            </div>
            <div className="settings-field">
              <label className="toggle-row">
                <input type="checkbox" defaultChecked={localStorage.getItem('ow-sound-enabled') !== 'false'} onChange={e => localStorage.setItem('ow-sound-enabled', String(e.target.checked))} />
                <span>Play sound when a session is blocked</span>
              </label>
            </div>
          </div>
        )}

        {tab === 'agents' && (
          <div className="settings-content">
            <p className="settings-help">Enable or disable agents available in the session creation dropdown and tab menu.</p>
            <div className="toggle-list">
              {DEFAULT_AGENTS.map(a => (
                <label key={a.id} className="toggle-item">
                  <input type="checkbox" checked={enabledAgents.includes(a.id)} onChange={() => toggleAgent(a.id)} />
                  <div className="toggle-info">
                    <span className="toggle-label">{a.label}</span>
                    <span className="toggle-desc">{a.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {tab === 'integrations' && (
          <div className="settings-content">
            <p className="settings-help">Enable or disable "Open With" integrations shown in session and Overwatch toolbars.</p>
            <div className="toggle-list">
              {DEFAULT_INTEGRATIONS.map(a => (
                <label key={a.id} className="toggle-item">
                  <input type="checkbox" checked={enabledIntegrations.includes(a.id)} onChange={() => toggleIntegration(a.id)} />
                  <div className="toggle-info">
                    <span className="toggle-label">{a.label}</span>
                    <span className="toggle-desc">{a.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {tab === 'mcp' && (
          <div className="settings-content">
            <div className="settings-field">
              <label>Connected MCP Servers</label>
              <p className="settings-help">Servers the Overwatch agent connects to for tools. Restart app after changes.</p>
              {mcpServers.length === 0 ? (
                <p className="settings-help">No MCP servers configured.</p>
              ) : (
                <div className="mcp-server-list">
                  {mcpServers.map((s, i) => (
                    <div key={s.name} className="mcp-server-item">
                      <div>
                        <span className="mcp-server-name">{s.name}</span>
                        <code className="mcp-server-cmd">{s.command} {(s.args ?? []).join(' ')}</code>
                      </div>
                      <button className="btn-mcp-remove" onClick={() => setMcpServers(prev => prev.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mcp-add-row">
                <input placeholder="Name" value={newMcpName} onChange={e => setNewMcpName(e.target.value)} />
                <input placeholder="Command (e.g. my-mcp-server)" value={newMcpCommand} onChange={e => setNewMcpCommand(e.target.value)} />
                <button className="btn-mcp-add" onClick={() => {
                  if (newMcpName.trim() && newMcpCommand.trim()) {
                    const parts = newMcpCommand.trim().split(/\s+/)
                    setMcpServers(prev => [...prev, { name: newMcpName.trim(), command: parts[0], args: parts.slice(1) }])
                    setNewMcpName('')
                    setNewMcpCommand('')
                  }
                }}>Add</button>
              </div>
            </div>
            <div className="settings-field">
              <label>Overwatch MCP Server</label>
              <p className="settings-help">External agents can connect to Overwatch via MCP.</p>
              <div className="mcp-info-box">
                <div className="mcp-info-row"><span className="mcp-label">Endpoint</span><code>http://127.0.0.1:3777/mcp</code></div>
                <div className="mcp-info-row"><span className="mcp-label">Transport</span><code>Streamable HTTP</code></div>
              </div>
            </div>
            <div className="settings-field">
              <label>Connect from another agent</label>
              <pre className="mcp-config-block">{JSON.stringify({ overwatch: { url: 'http://127.0.0.1:3777/mcp' } }, null, 2)}</pre>
            </div>
          </div>
        )}

        <div className="settings-actions">
          <button className="btn-settings-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-settings-save" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
