export interface FolderColor {
  key: string
  name: string
  hex: string
}

export const FOLDER_COLORS: FolderColor[] = [
  { key: 'ember', name: 'Ember', hex: '#f59e0b' },
  { key: 'ochre', name: 'Ochre', hex: '#d97706' },
  { key: 'saffron', name: 'Saffron', hex: '#eab308' },
  { key: 'persimmon', name: 'Persimmon', hex: '#ef4444' },
  { key: 'sangria', name: 'Sangria', hex: '#be123c' },
  { key: 'coral', name: 'Coral', hex: '#fb7185' },
  { key: 'rose-quartz', name: 'Rose Quartz', hex: '#ec4899' },
  { key: 'orchid', name: 'Orchid', hex: '#d946ef' },
  { key: 'iris', name: 'Iris', hex: '#8b5cf6' },
  { key: 'indigo-ink', name: 'Indigo Ink', hex: '#6366f1' },
  { key: 'lagoon', name: 'Lagoon', hex: '#0ea5e9' },
  { key: 'cerulean', name: 'Cerulean', hex: '#2563eb' },
  { key: 'teal-bloom', name: 'Teal Bloom', hex: '#14b8a6' },
  { key: 'jade', name: 'Jade', hex: '#10b981' },
  { key: 'mantis', name: 'Mantis', hex: '#84cc16' },
  { key: 'moss', name: 'Moss', hex: '#65a30d' },
  { key: 'mocha', name: 'Mocha', hex: '#92400e' },
  { key: 'dune', name: 'Dune', hex: '#a16207' },
  { key: 'slate-tide', name: 'Slate Tide', hex: '#475569' },
  { key: 'graphite', name: 'Graphite', hex: '#374151' },
]

export const FOLDER_COLOR_KEYS = FOLDER_COLORS.map((c) => c.key)

export const DEFAULT_COLOR_KEY = 'slate-tide'

const COLOR_MAP: Record<string, FolderColor> = FOLDER_COLORS.reduce(
  (acc, c) => {
    acc[c.key] = c
    return acc
  },
  {} as Record<string, FolderColor>,
)

export function isValidColorKey(key: string): boolean {
  return key in COLOR_MAP
}

export function getColor(key: string): FolderColor {
  return COLOR_MAP[key] ?? COLOR_MAP[DEFAULT_COLOR_KEY]!
}
