import { describe, it, expect, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const uploadZonePath = ['~', 'components', 'documents', 'FileUploadZone.vue'].join('/')

describe('FileUploadZone — AC #1, #4, #5', () => {
  it('[P0] should render drop zone with drag text on desktop', async () => {
    const FileUploadZone = await import(uploadZonePath)

    const wrapper = await mountSuspended(FileUploadZone.default, {
      props: { folderId: 'folder_123' as any },
    })

    expect(wrapper.text()).toContain('Drag PDFs here')
    expect(wrapper.text()).toContain('browse')
  })

  it('[P0] should have role="button" and be keyboard activatable', async () => {
    const FileUploadZone = await import(uploadZonePath)

    const wrapper = await mountSuspended(FileUploadZone.default, {
      props: { folderId: 'folder_123' as any },
    })

    const dropZone = wrapper.find('[role="button"]')
    expect(dropZone.exists()).toBe(true)
    expect(dropZone.attributes('tabindex')).toBe('0')
    expect(dropZone.attributes('aria-label')).toBe('Upload PDF files')
  })

  it('[P0] should have file input that accepts PDF only', async () => {
    const FileUploadZone = await import(uploadZonePath)

    const wrapper = await mountSuspended(FileUploadZone.default, {
      props: { folderId: 'folder_123' as any },
    })

    const fileInput = wrapper.find('input[type="file"]')
    expect(fileInput.exists()).toBe(true)
    expect(fileInput.attributes('accept')).toBe('application/pdf')
  })

  it('[P0] should emit upload event with valid PDF files', async () => {
    const FileUploadZone = await import(uploadZonePath)

    const wrapper = await mountSuspended(FileUploadZone.default, {
      props: { folderId: 'folder_123' as any },
    })

    const pdfFile = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' })
    const fileInput = wrapper.find('input[type="file"]')
    const inputEl = fileInput.element as HTMLInputElement

    Object.defineProperty(inputEl, 'files', { value: [pdfFile], writable: false })
    await fileInput.trigger('change')

    expect(wrapper.emitted('upload')).toBeTruthy()
    expect(wrapper.emitted('upload')![0][0]).toHaveLength(1)
  })

  it('[P0] should reject non-PDF files', async () => {
    const FileUploadZone = await import(uploadZonePath)

    const wrapper = await mountSuspended(FileUploadZone.default, {
      props: { folderId: 'folder_123' as any },
    })

    const txtFile = new File(['text content'], 'notes.txt', { type: 'text/plain' })
    const fileInput = wrapper.find('input[type="file"]')
    const inputEl = fileInput.element as HTMLInputElement

    Object.defineProperty(inputEl, 'files', { value: [txtFile], writable: false })
    await fileInput.trigger('change')

    const uploadEvents = wrapper.emitted('upload')
    expect(!uploadEvents || uploadEvents[0][0].length === 0).toBe(true)
  })

  it('[P0] should reject files exceeding 50MB', async () => {
    const FileUploadZone = await import(uploadZonePath)

    const wrapper = await mountSuspended(FileUploadZone.default, {
      props: { folderId: 'folder_123' as any },
    })

    const largeFile = new File(['x'.repeat(100)], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(largeFile, 'size', { value: 52_428_801 })

    const fileInput = wrapper.find('input[type="file"]')
    const inputEl = fileInput.element as HTMLInputElement

    Object.defineProperty(inputEl, 'files', { value: [largeFile], writable: false })
    await fileInput.trigger('change')

    const uploadEvents = wrapper.emitted('upload')
    expect(!uploadEvents || uploadEvents[0][0].length === 0).toBe(true)
  })

  it('[P1] should show dashed border on initial render', async () => {
    const FileUploadZone = await import(uploadZonePath)

    const wrapper = await mountSuspended(FileUploadZone.default, {
      props: { folderId: 'folder_123' as any },
    })

    const dropZone = wrapper.find('[role="button"]')
    expect(dropZone.classes().some((c: string) => c.includes('border-dashed'))).toBe(true)
  })

  it('[P1] should be disabled when disabled prop is true', async () => {
    const FileUploadZone = await import(uploadZonePath)

    const wrapper = await mountSuspended(FileUploadZone.default, {
      props: { folderId: 'folder_123' as any, disabled: true },
    })

    const dropZone = wrapper.find('[role="button"]')
    expect(dropZone.attributes('aria-disabled')).toBe('true')
  })
})
