import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useTheme } from '../ThemeProvider'
import '@xterm/xterm/css/xterm.css'

interface Props {
  tabId: string
  visible: boolean
}

export const TerminalView = React.memo(function TerminalView({ tabId, visible }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [loading, setLoading] = useState(true)
  const { theme } = useTheme()

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'JetBrains Mono Variable', Menlo, Monaco, monospace",
      theme: {
        background: theme.terminal.background,
        foreground: theme.terminal.foreground,
        cursor: theme.terminal.cursor
      }
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    term.onData(data => {
      window.overwatch.terminal.write(tabId, data)
    })

    const removeListener = window.overwatch.terminal.onData((id, data) => {
      if (id === tabId) {
        setLoading(false)
        term.write(data)
      }
    })
    cleanupRef.current = removeListener

    // Load previous scrollback, write as dim history, then spawn
    window.overwatch.terminal.scrollback(tabId).then(history => {
      if (history) {
        term.write('\x1b[2m') // dim
        term.write(history)
        term.write('\x1b[0m') // reset
        term.write('\r\n--- session restored ---\r\n\r\n')
      }
      window.overwatch.terminal.spawn(tabId)
    })

    const resizeObserver = new ResizeObserver(() => fit.fit())
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      cleanupRef.current?.()
      cleanupRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [tabId])

  useEffect(() => {
    if (visible && fitRef.current) {
      setTimeout(() => fitRef.current?.fit(), 0)
    }
  }, [visible])

  return (
    <div className="terminal-wrapper" style={{ display: visible ? 'flex' : 'none' }}>
      {loading && (
        <div className="terminal-loading">
          <div className="loading-spinner" />
          <span>Loading...</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="terminal-container"
        style={{ opacity: loading ? 0 : 1 }}
      />
    </div>
  )
})
