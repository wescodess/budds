export type AppThemeMode = 'dark' | 'light'

export const APP_THEME_STORAGE_KEY = 'budds-color-mode'
export const FOLDER_THEME_STORAGE_KEY = 'budds-folder-theme'

function resolveThemeMode(stored: string | null | undefined, prefersDark: boolean): AppThemeMode {
  if (stored === 'dark' || stored === 'light') return stored
  return prefersDark ? 'dark' : 'light'
}

function applyThemeMode(mode: AppThemeMode) {
  if (!import.meta.client) return
  const root = document.documentElement
  if (!root?.style) return
  root.classList.toggle('dark', mode === 'dark')
  root.classList.toggle('light', mode === 'light')
  root.style.colorScheme = mode
}

export function getAppThemeBootstrapScript() {
  return `(() => {
    const key = '${APP_THEME_STORAGE_KEY}';
    const getResolvedMode = () => {
      try {
        const stored = window.localStorage.getItem(key);
        if (stored === 'dark' || stored === 'light') return stored;
      } catch {}
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const mode = getResolvedMode();
    const root = document.documentElement;
    if (!root || !root.style) return;
    root.classList.toggle('dark', mode === 'dark');
    root.classList.toggle('light', mode === 'light');
    root.style.colorScheme = mode;
  })();`
}

export function useAppTheme() {
  const mode = useState<AppThemeMode>('app-theme-mode', () => {
    if (import.meta.client) {
      const root = document.documentElement
      return root?.classList.contains('dark') ? 'dark' : 'light'
    }
    return 'light'
  })

  const folderThemeEnabled = useState<boolean>('folder-theme-enabled', () => true)

  onMounted(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const stored = (() => {
      try {
        return window.localStorage.getItem(APP_THEME_STORAGE_KEY)
      } catch {
        return null
      }
    })()
    const resolved = resolveThemeMode(stored, prefersDark)
    applyThemeMode(resolved)
    mode.value = resolved

    try {
      const folderThemeStored = window.localStorage.getItem(FOLDER_THEME_STORAGE_KEY)
      if (folderThemeStored !== null) folderThemeEnabled.value = folderThemeStored !== 'false'
    } catch {
      // The default remains active when storage is unavailable.
    }
  })

  function setTheme(next: AppThemeMode) {
    mode.value = next
    applyThemeMode(next)
    if (import.meta.client) {
      try {
        window.localStorage.setItem(APP_THEME_STORAGE_KEY, next)
      } catch {
        // The selected theme still applies for the current session.
      }
    }
  }

  function toggleTheme() {
    setTheme(mode.value === 'dark' ? 'light' : 'dark')
  }

  function toggleFolderTheme() {
    folderThemeEnabled.value = !folderThemeEnabled.value
    if (import.meta.client) {
      try {
        window.localStorage.setItem(FOLDER_THEME_STORAGE_KEY, String(folderThemeEnabled.value))
      } catch {
        // The folder preference still applies for the current session.
      }
    }
  }

  return { mode, setTheme, toggleTheme, folderThemeEnabled, toggleFolderTheme }
}
