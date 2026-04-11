import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const statusItemPath = ['~', 'components', 'documents', 'FileStatusItem.vue'].join('/')

describe('FileStatusItem — AC #3', () => {
  it('[P0] should render processing state with spinner and filename', async () => {
    const FileStatusItem = await import(statusItemPath)

    const wrapper = await mountSuspended(FileStatusItem.default, {
      props: {
        filename: 'lecture.pdf',
        status: 'processing' as const,
        fileSize: 2_097_152,
        createdAt: Date.now(),
      },
    })

    expect(wrapper.text()).toContain('lecture.pdf')
    const spinner = wrapper.find('.animate-spin')
    expect(spinner.exists()).toBe(true)
  })

  it('[P0] should render success state with check icon', async () => {
    const FileStatusItem = await import(statusItemPath)

    const wrapper = await mountSuspended(FileStatusItem.default, {
      props: {
        filename: 'syllabus.pdf',
        status: 'success' as const,
        fileSize: 512_000,
        createdAt: Date.now() - 3600_000,
      },
    })

    expect(wrapper.text()).toContain('syllabus.pdf')
    const spinner = wrapper.find('.animate-spin')
    expect(spinner.exists()).toBe(false)
  })

  it('[P0] should render failed state with error message', async () => {
    const FileStatusItem = await import(statusItemPath)

    const wrapper = await mountSuspended(FileStatusItem.default, {
      props: {
        filename: 'corrupt.pdf',
        status: 'failed' as const,
        fileSize: 1024,
        createdAt: Date.now(),
        failureReason: 'PDF parsing failed: invalid header',
      },
    })

    expect(wrapper.text()).toContain('corrupt.pdf')
    expect(wrapper.text()).toContain('PDF parsing failed: invalid header')
  })

  it('[P1] should format file size in KB for small files', async () => {
    const FileStatusItem = await import(statusItemPath)

    const wrapper = await mountSuspended(FileStatusItem.default, {
      props: {
        filename: 'small.pdf',
        status: 'success' as const,
        fileSize: 5120,
        createdAt: Date.now(),
      },
    })

    expect(wrapper.text()).toMatch(/5\s*KB/)
  })

  it('[P1] should format file size in MB for large files', async () => {
    const FileStatusItem = await import(statusItemPath)

    const wrapper = await mountSuspended(FileStatusItem.default, {
      props: {
        filename: 'large.pdf',
        status: 'success' as const,
        fileSize: 10_485_760,
        createdAt: Date.now(),
      },
    })

    expect(wrapper.text()).toMatch(/10\s*MB/)
  })

  it('[P1] should have aria-live="polite" on status region', async () => {
    const FileStatusItem = await import(statusItemPath)

    const wrapper = await mountSuspended(FileStatusItem.default, {
      props: {
        filename: 'test.pdf',
        status: 'processing' as const,
        fileSize: 1024,
        createdAt: Date.now(),
      },
    })

    const liveRegion = wrapper.find('[aria-live="polite"]')
    expect(liveRegion.exists()).toBe(true)
  })
})
