import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const mockFolders = ref([
  { _id: 'folder_1', name: 'Organic Chemistry', userId: 'u1' },
  { _id: 'folder_2', name: 'Biology 101', userId: 'u1' },
])

const mockDocCounts = ref([
  { folderId: 'folder_1', count: 18 },
  { folderId: 'folder_2', count: 12 },
])

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: any, _args?: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('listAllFolders')) return { data: mockFolders }
    if (name.includes('countsByFolder')) return { data: mockDocCounts }
    return { data: ref(null) }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return () => ({ mutate: vi.fn(), isLoading: ref(false) })
})

const componentPath = ['~', 'components', 'learn', 'SourceSelector.vue'].join('/')

describe('SourceSelector', () => {
  beforeEach(() => {
    mockFolders.value = [
      { _id: 'folder_1', name: 'Organic Chemistry', userId: 'u1' },
      { _id: 'folder_2', name: 'Biology 101', userId: 'u1' },
    ]
    mockDocCounts.value = [
      { folderId: 'folder_1', count: 18 },
      { folderId: 'folder_2', count: 12 },
    ]
  })

  it('renders topic input and folder list', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="topic-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="source-selector"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="folder-checkbox"]').length).toBe(2)
  })

  it('renders folder names and doc counts', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    const text = wrapper.text()
    expect(text).toContain('Organic Chemistry')
    expect(text).toContain('18 docs')
    expect(text).toContain('Biology 101')
    expect(text).toContain('12 docs')
  })

  it('disables generate button when no input', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    const btn = wrapper.find('[data-testid="generate-outline-button"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables button when topic is entered', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    const input = wrapper.find('[data-testid="topic-input"]')
    await input.setValue('React hooks')
    const btn = wrapper.find('[data-testid="generate-outline-button"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('emits submit with web-only sourceType for topic-only', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
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

  it('emits submit with folder sourceType when folder selected', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    await wrapper.find('[data-testid="topic-input"]').setValue('Organic Chemistry')
    const checkboxes = wrapper.findAll('[data-testid="folder-checkbox"]')
    await checkboxes[0]!.setValue(true)
    await wrapper.find('[data-testid="generate-outline-button"]').trigger('click')
    const emitted = wrapper.emitted('submit')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toMatchObject({
      sourceType: 'folder',
      folderIds: ['folder_1'],
    })
  })

  it('shows web supplement hint for topic-only input', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    await wrapper.find('[data-testid="topic-input"]').setValue('React hooks')
    expect(wrapper.text()).toContain('Web sources will be used automatically')
  })

  it('renders empty state when no folders', async () => {
    mockFolders.value = []
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.text()).toContain('No folders yet')
  })
})
