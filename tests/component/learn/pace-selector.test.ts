import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const mockUpdatePace = vi.fn()

mockNuxtImport('useConvexMutation', () => {
  return (apiRef: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('updatePace')) return { mutate: mockUpdatePace, isLoading: ref(false) }
    return { mutate: vi.fn(), isLoading: ref(false) }
  }
})

const componentPath = ['~', 'components', 'learn', 'PaceSelector.vue'].join('/')

function baseProps() {
  return {
    courseId: 'course_1' as any,
    currentPace: 'steady' as const,
  }
}

describe('PaceSelector', () => {
  beforeEach(() => {
    mockUpdatePace.mockReset()
  })

  it('renders 3 pace options', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps() })
    const options = wrapper.findAll('[data-testid="pace-option"]')
    expect(options).toHaveLength(3)
  })

  it('pre-selects the current pace', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps() })
    const select = wrapper.find('[data-testid="pace-select"]').element as HTMLSelectElement
    expect(select.value).toBe('steady')
  })

  it('calls updatePace mutation on change', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps() })
    const select = wrapper.find('[data-testid="pace-select"]')
    await select.setValue('intensive')
    expect(mockUpdatePace).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'course_1', pace: 'intensive' }),
    )
  })

  it('displays pace descriptions in options', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps() })
    const options = wrapper.findAll('[data-testid="pace-option"]')
    const texts = options.map((o) => o.text())
    expect(texts[0]).toContain('Intensive')
    expect(texts[0]).toContain('Learn faster')
    expect(texts[1]).toContain('Steady')
    expect(texts[2]).toContain('Relaxed')
  })
})
