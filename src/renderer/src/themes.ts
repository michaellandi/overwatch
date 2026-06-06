export interface Theme {
  name: string
  vars: Record<string, string>
  terminal: { background: string; foreground: string; cursor: string }
}

export const themes: Record<string, Theme> = {
  obsidian: {
    name: 'Obsidian',
    vars: {
      '--bg': '#1e1e1e',
      '--surface': '#262626',
      '--border': '#3a3a3a',
      '--text': '#dcdcdc',
      '--text-dim': '#7a7a7a',
      '--accent': '#a88bfa',
      '--stuck': '#e06c75',
      '--waiting': '#e5c07b',
      '--running': '#98c379',
      '--done': '#5c6370',
    },
    terminal: { background: '#1e1e1e', foreground: '#dcdcdc', cursor: '#a88bfa' }
  },
  midnight: {
    name: 'Midnight',
    vars: {
      '--bg': '#0d1117',
      '--surface': '#161b22',
      '--border': '#30363d',
      '--text': '#c9d1d9',
      '--text-dim': '#6e7681',
      '--accent': '#58a6ff',
      '--stuck': '#f85149',
      '--waiting': '#d29922',
      '--running': '#3fb950',
      '--done': '#484f58',
    },
    terminal: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' }
  },
  nord: {
    name: 'Nord',
    vars: {
      '--bg': '#2e3440',
      '--surface': '#3b4252',
      '--border': '#4c566a',
      '--text': '#eceff4',
      '--text-dim': '#939aad',
      '--accent': '#88c0d0',
      '--stuck': '#bf616a',
      '--waiting': '#ebcb8b',
      '--running': '#a3be8c',
      '--done': '#616e88',
    },
    terminal: { background: '#2e3440', foreground: '#eceff4', cursor: '#88c0d0' }
  },
  dracula: {
    name: 'Dracula',
    vars: {
      '--bg': '#282a36',
      '--surface': '#2d303d',
      '--border': '#44475a',
      '--text': '#f8f8f2',
      '--text-dim': '#6272a4',
      '--accent': '#bd93f9',
      '--stuck': '#ff5555',
      '--waiting': '#f1fa8c',
      '--running': '#50fa7b',
      '--done': '#545672',
    },
    terminal: { background: '#282a36', foreground: '#f8f8f2', cursor: '#bd93f9' }
  },
  light: {
    name: 'Light',
    vars: {
      '--bg': '#ffffff',
      '--surface': '#f5f5f5',
      '--border': '#e0e0e0',
      '--text': '#1e1e1e',
      '--text-dim': '#6b6b6b',
      '--accent': '#6750a4',
      '--stuck': '#ba1a1a',
      '--waiting': '#7c5800',
      '--running': '#1b6d2f',
      '--done': '#9e9e9e',
    },
    terminal: { background: '#ffffff', foreground: '#1e1e1e', cursor: '#6750a4' }
  }
}

export const DEFAULT_THEME = 'obsidian'
