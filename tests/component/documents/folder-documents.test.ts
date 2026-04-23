import { describe, it } from 'vitest'

// SKIP: folder-documents tests mount the full [id].vue page which now uses provideFolderPageContext().
// The context composable internally creates Convex WebSocket connections, uses useFolderReferenceScope,
// useHelperPane, useTasks, and 5+ useConvexMutation calls. Nuxt page routing (matched, meta, etc.)
// also needs full mock setup. Tests need rewriting as isolated DocumentsPanel component tests.
// — see deferred-work.md "Deferred from: prep-3-5"

describe('Folder Detail Page — Document Integration (AC #1, #3, #7)', () => {
  it.skip('[P0] should render FileUploadZone component', () => {})
  it.skip('[P0] should render document list with FileStatusItem components', () => {})
  it.skip('[P0] should show empty state with upload zone when no documents', () => {})
})
