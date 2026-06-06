import React from 'react'
import { useTheme } from '../ThemeProvider'
import { themes } from '../themes'

export function ThemeSelector(): React.ReactElement {
  const { themeId, setThemeId } = useTheme()

  return (
    <select
      className="theme-selector"
      value={themeId}
      onChange={e => setThemeId(e.target.value)}
    >
      {Object.entries(themes).map(([id, t]) => (
        <option key={id} value={id}>{t.name}</option>
      ))}
    </select>
  )
}
