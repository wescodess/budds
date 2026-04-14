import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import FileStatusPill from '~/components/folder-shell/FileStatusPill.vue'

describe('FileStatusPill — status mapping', () => {
  it('renders "Indexed" for success', async () => {
    const w = await mountSuspended(FileStatusPill, { props: { status: 'success' } })
    expect(w.text()).toContain('Indexed')
    expect(w.attributes('data-status')).toBe('success')
  })

  it('renders "Processing" for processing and indexing', async () => {
    const a = await mountSuspended(FileStatusPill, { props: { status: 'processing' } })
    const b = await mountSuspended(FileStatusPill, { props: { status: 'indexing' } })
    expect(a.text()).toContain('Processing')
    expect(b.text()).toContain('Processing')
  })

  it('renders "Queued" for pending', async () => {
    const w = await mountSuspended(FileStatusPill, { props: { status: 'pending' } })
    expect(w.text()).toContain('Queued')
  })

  it('renders "Failed" for failed with failureReason as title', async () => {
    const w = await mountSuspended(FileStatusPill, {
      props: { status: 'failed', failureReason: 'OCR timeout' },
    })
    expect(w.text()).toContain('Failed')
    expect(w.attributes('title')).toBe('OCR timeout')
  })
})
