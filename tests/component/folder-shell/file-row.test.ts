import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import FolderShellFileRow from '~/components/folder-shell/FolderShellFileRow.vue'

describe('FolderShellFileRow', () => {
  const baseProps = {
    documentId: 'doc_1' as any,
    filename: 'notes.pdf',
    status: 'success' as const,
    fileSize: 1024 * 1024 * 2,
    createdAt: Date.now(),
  }

  it('renders filename and size subtitle in panel variant', async () => {
    const w = await mountSuspended(FolderShellFileRow, { props: baseProps })
    expect(w.text()).toContain('notes.pdf')
    expect(w.text()).toContain('PDF')
    expect(w.text()).toContain('MB')
  })

  it('renders list variant with status and size columns', async () => {
    const w = await mountSuspended(FolderShellFileRow, {
      props: { ...baseProps, variant: 'list' },
    })
    expect(w.text()).toContain('notes.pdf')
    expect(w.text()).toContain('Indexed')
  })

  it('shows Failed pill when status=failed', async () => {
    const w = await mountSuspended(FolderShellFileRow, {
      props: { ...baseProps, status: 'failed', failureReason: 'bad' },
    })
    expect(w.text()).toContain('Failed')
  })
})
