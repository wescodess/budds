import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockMutate = vi.fn()

mockNuxtImport('useConvexMutation', () => {
  return () => ({ mutate: mockMutate, isLoading: ref(false) })
})

const componentPath = ['~', 'components', 'learn', 'SessionPreferencesForm.vue'].join('/')

describe('SessionPreferencesForm', () => {
  beforeEach(() => {
    mockMutate.mockReset()
  })

  it('renders the form', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { preferences: null },
    })
    expect(wrapper.find('[data-testid="session-preferences-form"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Session Preferences')
  })

  it('shows default values when no preferences provided', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { preferences: null },
    })
    const morningInput = wrapper.find('[data-testid="pref-morning-start"]')
    expect((morningInput.element as HTMLInputElement).value).toBe('08:00')
    const eveningInput = wrapper.find('[data-testid="pref-evening-end"]')
    expect((eveningInput.element as HTMLInputElement).value).toBe('21:00')
  })

  it('shows provided preferences', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: {
        preferences: {
          morningStart: '07:30',
          eveningEnd: '19:00',
          sessionMinutes: 25,
          preferredDays: ['sat', 'sun'],
        },
      },
    })
    const morningInput = wrapper.find('[data-testid="pref-morning-start"]')
    expect((morningInput.element as HTMLInputElement).value).toBe('07:30')
    const btn25 = wrapper.find('[data-testid="pref-session-25"]')
    expect(btn25.attributes('aria-checked')).toBe('true')
    const satBtn = wrapper.find('[data-testid="pref-day-sat"]')
    expect(satBtn.attributes('aria-pressed')).toBe('true')
  })

  it('toggles day selection', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { preferences: null },
    })
    const satBtn = wrapper.find('[data-testid="pref-day-sat"]')
    expect(satBtn.attributes('aria-pressed')).toBe('false')
    await satBtn.trigger('click')
    expect(satBtn.attributes('aria-pressed')).toBe('true')
  })

  it('changes session length on click', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { preferences: null },
    })
    const btn10 = wrapper.find('[data-testid="pref-session-10"]')
    await btn10.trigger('click')
    expect(btn10.attributes('aria-checked')).toBe('true')
    const btn15 = wrapper.find('[data-testid="pref-session-15"]')
    expect(btn15.attributes('aria-checked')).toBe('false')
  })

  it('shows save button only when dirty', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { preferences: null },
    })
    expect(wrapper.find('[data-testid="pref-save"]').exists()).toBe(false)
    const btn10 = wrapper.find('[data-testid="pref-session-10"]')
    await btn10.trigger('click')
    expect(wrapper.find('[data-testid="pref-save"]').exists()).toBe(true)
  })

  it('calls mutation on save', async () => {
    mockMutate.mockResolvedValue(undefined)
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { preferences: null },
    })
    const btn10 = wrapper.find('[data-testid="pref-session-10"]')
    await btn10.trigger('click')
    const saveBtn = wrapper.find('[data-testid="pref-save"]')
    await saveBtn.trigger('click')
    expect(mockMutate).toHaveBeenCalledWith({
      morningStart: '08:00',
      eveningEnd: '21:00',
      sessionMinutes: 10,
      preferredDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    })
  })

  it('renders all session length options', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { preferences: null },
    })
    expect(wrapper.find('[data-testid="pref-session-5"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pref-session-10"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pref-session-15"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pref-session-25"]').exists()).toBe(true)
  })

  it('renders all day buttons', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { preferences: null },
    })
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      expect(wrapper.find(`[data-testid="pref-day-${day}"]`).exists()).toBe(true)
    }
  })
})
