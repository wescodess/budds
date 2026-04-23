import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const mockUpdateTitle = vi.fn()
const mockUpdateKnowledgeType = vi.fn()
const mockRemove = vi.fn()
const mockCreate = vi.fn()
const mockUpdateOrder = vi.fn()

mockNuxtImport('useConvexMutation', () => {
  return (apiRef: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('updateTitle')) return { mutate: mockUpdateTitle, isLoading: ref(false) }
    if (name.includes('updateKnowledgeType')) return { mutate: mockUpdateKnowledgeType, isLoading: ref(false) }
    if (name.includes('remove')) return { mutate: mockRemove, isLoading: ref(false) }
    if (name.includes('create')) return { mutate: mockCreate, isLoading: ref(false) }
    if (name.includes('updateOrder')) return { mutate: mockUpdateOrder, isLoading: ref(false) }
    return { mutate: vi.fn(), isLoading: ref(false) }
  }
})

const editorPath = ['~', 'components', 'learn', 'OutlineEditor.vue'].join('/')

function sampleSections() {
  return [
    { _id: 'sec_1' as any, order: 0, title: 'Functional Groups', knowledgeType: 'factual' as const },
    { _id: 'sec_2' as any, order: 1, title: 'Reaction Mechanisms', knowledgeType: 'conceptual' as const },
    { _id: 'sec_3' as any, order: 2, title: 'Stereochemistry', knowledgeType: 'procedural' as const },
  ]
}

function baseProps() {
  return {
    courseId: 'course_1' as any,
    outlineSections: [
      { title: 'Functional Groups', description: '', knowledgeType: 'factual', order: 0 },
      { title: 'Reaction Mechanisms', description: '', knowledgeType: 'conceptual', order: 1 },
      { title: 'Stereochemistry', description: '', knowledgeType: 'procedural', order: 2 },
    ],
    sourceConfidence: { docCount: 14, webPercent: 0 },
    sourceType: 'folder' as const,
    sections: sampleSections(),
  }
}

describe('OutlineEditor', () => {
  beforeEach(() => {
    mockUpdateTitle.mockReset()
    mockUpdateKnowledgeType.mockReset()
    mockRemove.mockReset()
    mockCreate.mockReset()
    mockUpdateOrder.mockReset()
  })

  it('renders correct number of section rows', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, { props: baseProps() })
    const rows = wrapper.findAll('[data-testid="section-row"]')
    expect(rows).toHaveLength(3)
  })

  it('displays section titles in order', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, { props: baseProps() })
    const titles = wrapper.findAll('[data-testid="section-title"]')
    expect(titles[0].text()).toBe('Functional Groups')
    expect(titles[1].text()).toBe('Reaction Mechanisms')
    expect(titles[2].text()).toBe('Stereochemistry')
  })

  it('shows source confidence for folder courses', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, { props: baseProps() })
    const card = wrapper.find('[data-testid="source-confidence"]')
    expect(card.text()).toContain('Draws from 14 of your documents')
  })

  it('shows source confidence for web-only courses', async () => {
    const Editor = await import(editorPath)
    const props = {
      ...baseProps(),
      sourceType: 'web-only' as const,
      sourceConfidence: { docCount: 0, webPercent: 100 },
    }
    const wrapper = await mountSuspended(Editor.default, { props })
    const card = wrapper.find('[data-testid="source-confidence"]')
    expect(card.text()).toContain('Built from web sources')
  })

  it('displays section count badge', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, { props: baseProps() })
    const badge = wrapper.find('[data-testid="section-count-badge"]')
    expect(badge.text()).toContain('3 sections')
  })

  it('enters inline edit mode on title click', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, { props: baseProps() })
    const firstTitle = wrapper.find('[data-testid="section-title"]')
    await firstTitle.trigger('click')
    const input = wrapper.find('[data-testid="title-input"]')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('Functional Groups')
  })

  it('saves title on Enter key', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, { props: baseProps() })
    await wrapper.find('[data-testid="section-title"]').trigger('click')
    const input = wrapper.find('[data-testid="title-input"]')
    await input.setValue('Updated Title')
    await input.trigger('keydown', { key: 'Enter' })
    expect(mockUpdateTitle).toHaveBeenCalledWith({
      sectionId: 'sec_1',
      title: 'Updated Title',
    })
  })

  it('cycles knowledge type on badge click', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, { props: baseProps() })
    const badges = wrapper.findAll('[data-testid="knowledge-type-badge"]')
    expect(badges[0].text()).toBe('factual')
    await badges[0].trigger('click')
    expect(mockUpdateKnowledgeType).toHaveBeenCalledWith({
      sectionId: 'sec_1',
      knowledgeType: 'conceptual',
    })
  })

  it('cycles through all knowledge types in order', async () => {
    const Editor = await import(editorPath)
    const props = baseProps()
    props.sections[0].knowledgeType = 'mixed'
    const wrapper = await mountSuspended(Editor.default, { props })
    const badge = wrapper.find('[data-testid="knowledge-type-badge"]')
    await badge.trigger('click')
    expect(mockUpdateKnowledgeType).toHaveBeenCalledWith({
      sectionId: 'sec_1',
      knowledgeType: 'factual',
    })
  })

  it('calls remove mutation on remove button click', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, { props: baseProps() })
    const removeButtons = wrapper.findAll('[data-testid="remove-button"]')
    await removeButtons[0].trigger('click')
    expect(mockRemove).toHaveBeenCalledWith({ sectionId: 'sec_1' })
  })

  it('calls create mutation on add section button click', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, { props: baseProps() })
    const addBtn = wrapper.find('[data-testid="add-section-button"]')
    await addBtn.trigger('click')
    expect(mockCreate).toHaveBeenCalledWith({ courseId: 'course_1' })
  })

  it('updates badge reactively when section count changes', async () => {
    const Editor = await import(editorPath)
    const props = baseProps()
    const wrapper = await mountSuspended(Editor.default, { props })
    expect(wrapper.find('[data-testid="section-count-badge"]').text()).toContain('3 sections')

    await wrapper.setProps({
      ...props,
      sections: sampleSections().slice(0, 2),
    })
    expect(wrapper.find('[data-testid="section-count-badge"]').text()).toContain('2 sections')
  })

  it('shows singular "section" for count of 1', async () => {
    const Editor = await import(editorPath)
    const props = baseProps()
    props.sections = [sampleSections()[0]]
    const wrapper = await mountSuspended(Editor.default, { props })
    expect(wrapper.find('[data-testid="section-count-badge"]').text()).toContain('1 section')
    expect(wrapper.find('[data-testid="section-count-badge"]').text()).not.toContain('1 sections')
  })

  it('has drag handles on each row', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, { props: baseProps() })
    const handles = wrapper.findAll('[data-testid="drag-handle"]')
    expect(handles).toHaveLength(3)
  })

  it('cancels edit on Escape key', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, { props: baseProps() })
    await wrapper.find('[data-testid="section-title"]').trigger('click')
    const input = wrapper.find('[data-testid="title-input"]')
    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-testid="title-input"]').exists()).toBe(false)
    expect(mockUpdateTitle).not.toHaveBeenCalled()
  })
})
