export interface FolderIconGroup {
  key: string
  label: string
  icons: string[]
}

export const FOLDER_ICON_GROUPS: FolderIconGroup[] = [
  {
    key: 'study',
    label: 'Study',
    icons: [
      'book-open',
      'notebook-pen',
      'graduation-cap',
      'library',
      'pencil',
      'highlighter',
      'bookmark',
      'brain-cog',
    ],
  },
  {
    key: 'subjects',
    label: 'Subjects',
    icons: [
      'calculator',
      'atom',
      'microscope',
      'flask-conical',
      'landmark',
      'globe-2',
      'palette',
      'music',
      'code-2',
      'languages',
    ],
  },
  {
    key: 'objects',
    label: 'Objects',
    icons: [
      'backpack',
      'briefcase',
      'folder',
      'file-stack',
      'clipboard-list',
      'lightbulb',
      'coffee',
    ],
  },
  {
    key: 'symbols',
    label: 'Symbols',
    icons: [
      'star',
      'heart',
      'flag',
      'target',
      'flame',
      'zap',
      'rocket',
      'trophy',
      'medal',
      'gem',
    ],
  },
  {
    key: 'nature',
    label: 'Nature',
    icons: [
      'leaf',
      'tree-pine',
      'sun',
      'moon',
      'cloud',
      'sprout',
      'mountain',
      'wind',
    ],
  },
  {
    key: 'misc',
    label: 'Misc',
    icons: ['compass', 'map', 'key', 'puzzle', 'shapes', 'sparkles'],
  },
]

export const FOLDER_ICON_KEYS: string[] = FOLDER_ICON_GROUPS.flatMap((g) => g.icons)

export const DEFAULT_ICON_KEY = 'folder'

const ICON_SET = new Set(FOLDER_ICON_KEYS)

export function isValidIconKey(key: string): boolean {
  return ICON_SET.has(key)
}
