import React, { createContext, useContext, useState, useEffect } from 'react'
import { themes, DEFAULT_THEME, type Theme } from './themes'

interface ThemeCtx {
  theme: Theme
  themeId: string
  setThemeId: (id: string) => void
}

const ThemeContext = createContext<ThemeCtx>({
  theme: themes[DEFAULT_THEME],
  themeId: DEFAULT_THEME,
  setThemeId: () => {}
})

export function useTheme(): ThemeCtx {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [themeId, setThemeId] = useState(() => localStorage.getItem('overwatch-theme') ?? DEFAULT_THEME)
  const theme = themes[themeId] ?? themes[DEFAULT_THEME]

  useEffect(() => {
    localStorage.setItem('overwatch-theme', themeId)
    const root = document.documentElement
    for (const [key, val] of Object.entries(theme.vars)) {
      root.style.setProperty(key, val)
    }
  }, [themeId, theme])

  return (
    <ThemeContext.Provider value={{ theme, themeId, setThemeId }}>
      {children}
    </ThemeContext.Provider>
  )
}
