import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const mockBacklog = ref<{ dueCount: number; dailyCap: number } | null>(null)
const mockScope = ref<any>(null)

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: any, _args?: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('getReviewBacklogCount')) return { data: mockBacklog }
    if (name.includes('searchScopeItems')) return { data: mockScope }
    return { data: ref(null) }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return () => ({ mutate: vi.fn(), isLoading: ref(false) })
})

const componentPath = ['~', 'components', 'learn', 'SourceSelector.vue'].join('/')

describe('SourceSelector', () => {
  beforeEach(() => {
    mockBacklog.value = null
    mockScope.value = {
      folders: [],
      files: [
        { id: 'doc_1', folderId: 'folder_1', filename: 'intro.pdf', fileSize: 1024 },
        { id: 'doc_2', folderId: 'folder_1', filename: 'chapter1.pdf', fileSize: 2048 },
      ],
    }
  })

  it('renders topic input and directory picker', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { folderId: 'folder_1' as any },
    })
    expect(wrapper.find('[data-testid="topic-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="source-selector"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="directory-picker"]').exists()).toBe(true)
  })

  it('shows no-docs message when folder has no files', async () => {
    mockScope.value = { folders: [], files: [] }
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { folderId: 'folder_1' as any },
    })
    expect(wrapper.text()).toContain('No documents')
    expect(wrapper.text()).toContain('web sources')
    expect(wrapper.find('[data-testid="directory-picker"]').exists()).toBe(false)
  })

  it('disables generate button when no input', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { folderId: 'folder_1' as any },
    })
    const btn = wrapper.find('[data-testid="generate-outline-button"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables button when topic is entered', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { folderId: 'folder_1' as any },
    })
    await wrapper.find('[data-testid="topic-input"]').setValue('React hooks')
    const btn = wrapper.find('[data-testid="generate-outline-button"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('emits submit with folder sourceType when docs exist', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { folderId: 'folder_1' as any },
    })
    await wrapper.find('[data-testid="topic-input"]').setValue('React hooks')
    await wrapper.find('[data-testid="generate-outline-button"]').trigger('click')
    const emitted = wrapper.emitted('submit')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toMatchObject({
      title: 'React hooks',
      sourceType: 'folder',
      folderId: 'folder_1',
      documentIds: [],
    })
  })

  it('characterizes V1 counting a selected folder without submitting its documents', async () => {
    mockScope.value = {
      folders: [
        { id: 'folder_child', name: 'Child Folder', fileCount: 2 },
      ],
      files: [
        { id: 'doc_child_1', folderId: 'folder_child', filename: 'one.pdf', fileSize: 1024 },
        { id: 'doc_child_2', folderId: 'folder_child', filename: 'two.pdf', fileSize: 2048 },
      ],
    }

    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { folderId: 'folder_root' as any },
    })

    await wrapper.find('[aria-label="Select Child Folder"]').trigger('click')
    await wrapper.find('[data-testid="topic-input"]').setValue('Folder selection baseline')

    expect(wrapper.text()).toContain('1 selected')

    await wrapper.find('[data-testid="generate-outline-button"]').trigger('click')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      title: 'Folder selection baseline',
      sourceType: 'folder',
      folderId: 'folder_root',
      // Frozen V1 defect: selected folder IDs are UI-only and neither the
      // folder nor its descendant document IDs are included in the payload.
      documentIds: [],
    })
  })

  it('emits submit with web-only sourceType when no docs', async () => {
    mockScope.value = { folders: [], files: [] }
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { folderId: 'folder_1' as any },
    })
    await wrapper.find('[data-testid="topic-input"]').setValue('React hooks')
    await wrapper.find('[data-testid="generate-outline-button"]').trigger('click')
    const emitted = wrapper.emitted('submit')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toMatchObject({
      title: 'React hooks',
      sourceType: 'web-only',
      webSearchEnabled: true,
    })
  })

  it('shows all-docs message when nothing selected', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { folderId: 'folder_1' as any },
    })
    expect(wrapper.text()).toContain('All 2 documents will be used')
  })

  it('shows backlog warning when due count exceeds 2x daily cap', async () => {
    mockBacklog.value = { dueCount: 120, dailyCap: 50 }
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { folderId: 'folder_1' as any },
    })
    expect(wrapper.find('[data-testid="backlog-warning"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('120 items due for review')
  })

  it('does not show backlog warning when due count is within threshold', async () => {
    mockBacklog.value = { dueCount: 80, dailyCap: 50 }
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { folderId: 'folder_1' as any },
    })
    expect(wrapper.find('[data-testid="backlog-warning"]').exists()).toBe(false)
  })
})
