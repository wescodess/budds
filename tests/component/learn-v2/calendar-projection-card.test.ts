import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const status = ref<any>(null)
const pending = ref(false)
const project = vi.fn()
const fetchMock = vi.fn()

mockNuxtImport('useConvexQuery', () => (reference: any) => {
  expect(getFunctionName(reference)).toContain('learnV2Calendar:getStatus')
  return { data: status, pending }
})
mockNuxtImport('useConvexAction', () => (reference: any) => {
  expect(getFunctionName(reference)).toContain('learnV2Calendar:projectSession')
  return { mutate: project }
})

const path = ['~', 'components', 'learn-v2', 'CalendarProjectionCard.vue'].join('/')
const future = Date.now() + 60_000

describe('LearnV2CalendarProjectionCard', () => {
  beforeEach(() => {
    status.value = { enabled: false, connection: 'not_connected', provider: null }
    pending.value = false
    project.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchMock)
  })
  async function mount() {
    const Component = await import(path)
    return mountSuspended(Component.default, { props: { studySessionId: 'session_1', scheduledStartAt: future } })
  }

  it('keeps the in-app plan available when projection is disabled', async () => {
    const wrapper = await mount()
    expect(wrapper.get('[data-testid="learn-v2-calendar-disabled"]').text()).toContain('in-app study plan is available')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('makes re-consent explicit when expanded calendar scopes are required', async () => {
    status.value = { enabled: true, connection: 'reconsent_required', provider: 'google' }
    const wrapper = await mount()
    expect(wrapper.get('[data-testid="learn-v2-calendar-connect"]').text()).toContain('Update Google Calendar access')
  })

  it('projects a future session once and announces an existing projection', async () => {
    status.value = { enabled: true, connection: 'ready', provider: 'google' }
    project.mockResolvedValue({ kind: 'already_projected' })
    const wrapper = await mount()
    await wrapper.get('[data-testid="learn-v2-calendar-project"]').trigger('click')
    await vi.waitFor(() => expect(project).toHaveBeenCalledWith({ studySessionId: 'session_1' }))
    expect(wrapper.get('[data-testid="learn-v2-calendar-message"]').text()).toContain('already on Google Calendar')
  })

  it('does not offer projection for a non-future session', async () => {
    status.value = { enabled: true, connection: 'ready', provider: 'google' }
    const Component = await import(path)
    const wrapper = await mountSuspended(Component.default, { props: { studySessionId: 'session_1', scheduledStartAt: 0 } })
    expect(wrapper.find('[data-testid="learn-v2-calendar-project"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-v2-calendar-not-future"]').text()).toContain('future')
  })

  it('requires confirmation before disconnecting', async () => {
    status.value = { enabled: true, connection: 'ready', provider: 'google' }
    fetchMock.mockResolvedValue({ disconnected: true })
    const wrapper = await mount()
    await wrapper.get('[data-testid="learn-v2-calendar-disconnect"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-v2-calendar-disconnect-confirm"]').attributes('role')).toBe('alertdialog')
    await wrapper.get('[data-testid="learn-v2-calendar-disconnect-confirm-button"]').trigger('click')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/learn-v2/calendar/disconnect', { method: 'POST' }))
  })
})
