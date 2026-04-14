export type AppThemeMode = 'dark' | 'light'

export const APP_THEME_STORAGE_KEY = 'budds-color-mode'

function resolveThemeMode(stored: string | null | undefined, prefersDark: boolean): AppThemeMode {
  if (stored === 'dark' || stored === 'light') return stored
  return prefersDark ? 'dark' : 'light'
}

function applyThemeMode(mode: AppThemeMode) {
  if (!import.meta.client) return
  const root = document.documentElement
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
    root.classList.toggle('dark', mode === 'dark');
    root.classList.toggle('light', mode === 'light');
    root.style.colorScheme = mode;
  })();`
}

export function useAppTheme() {
  const mode = useState<AppThemeMode>('app-theme-mode', () => {
    if (import.meta.client) {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    }
    return 'light'
  })

  onMounted(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY)
    } catch {
      stored = null
    }
    const resolved = resolveThemeMode(stored, prefersDark)
    applyThemeMode(resolved)
    mode.value = resolved
  })

  function setTheme(next: AppThemeMode) {
    mode.value = next
    applyThemeMode(next)
    if (import.meta.client) {
      try {
        window.localStorage.setItem(APP_THEME_STORAGE_KEY, next)
      } catch {
        // ignore storage failures
      }
    }
  }

  function toggleTheme() {
    setTheme(mode.value === 'dark' ? 'light' : 'dark')
  }

  return { mode, setTheme, toggleTheme }
}
