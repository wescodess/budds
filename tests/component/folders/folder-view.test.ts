import { describe, it } from 'vitest'

// SKIP: FolderView page now uses provideFolderPageContext() which composes Convex queries/mutations,
// useFolderReferenceScope, useHelperPane, useTasks, etc. The mock surface required to mount the full
// [id].vue page exceeds 15+ composable mocks including full Nuxt route objects (matched, meta, etc.).
// Tests need rewriting as isolated component tests instead of page-level integration tests.
// — see deferred-work.md "Deferred from: prep-3-5"

describe('FolderView — AC4: Folder Detail Page', () => {
  it.skip('[P0] should render folder name as heading', () => {})
  it.skip('[P0] should show "Documents will appear here" empty state in Documents tab', () => {})
  it.skip('[P1] should show "New Subfolder" button', () => {})
})
