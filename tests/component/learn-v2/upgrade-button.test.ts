import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const access = ref<any>({ kind: 'allowed' })
const pending = ref(false)
const upgrade = vi.fn()

mockNuxtImport('useConvexQuery', () => () => ({ data: access, pending }))
mockNuxtImport('useConvexMutation', () => (reference: any) => ({
  mutate: getFunctionName(reference)?.includes('upgradeLegacyCourse') ? upgrade : vi.fn(),
}))

const path = ['~', 'components', 'learn-v2', 'UpgradeLegacyCourseButton.vue'].join('/')

describe('LearnV2UpgradeLegacyCourseButton', () => {
  beforeEach(() => {
    access.value = { kind: 'allowed' }
    pending.value = false
    upgrade.mockReset().mockResolvedValue({ _id: 'void_1', status: 'draft', revision: 1 })
  })

  async function mount() {
    const Comp = await import(path)
    return await mountSuspended(Comp.default, { props: { legacyCourseId: 'course_1' } })
  }

  it('waits for the gate and does not expose an upgrade action before access is known', async () => {
    pending.value = true
    const wrapper = await mount()
    expect(wrapper.get('[data-testid="learn-v2-upgrade-pending"]').attributes('aria-live')).toBe('polite')
    expect(wrapper.find('[data-testid="learn-v2-upgrade"]').exists()).toBe(false)
  })

  it('keeps the upgrade unavailable when the account is not entitled', async () => {
    access.value = { kind: 'denied' }
    const wrapper = await mount()
    expect(wrapper.get('[data-testid="learn-v2-upgrade-denied"]').text()).toContain('not available for this account')
    expect(wrapper.find('[data-testid="learn-v2-upgrade"]').exists()).toBe(false)
  })

  it('creates one V2 draft and clearly preserves V1 progress and mastery', async () => {
    const wrapper = await mount()
    const button = wrapper.get('[data-testid="learn-v2-upgrade"]')
    expect(button.element.tagName).toBe('BUTTON')
    await button.trigger('click')
    await vi.waitFor(() => expect(upgrade).toHaveBeenCalledOnce())
    expect(upgrade).toHaveBeenCalledWith(expect.objectContaining({ legacyCourseId: 'course_1', idempotencyKey: expect.stringMatching(/^learn-v2-upgrade:/) }))
    expect(wrapper.get('[data-testid="learn-v2-upgrade-success"]').text()).toContain('V1 progress and mastery stay in V1')
  })

  it('uses the same idempotency key when a failed request is retried', async () => {
    upgrade.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({ _id: 'void_1', status: 'draft', revision: 1 })
    const wrapper = await mount()
    await wrapper.get('[data-testid="learn-v2-upgrade"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-v2-upgrade-error"]')).toBeTruthy())
    const firstKey = upgrade.mock.calls[0]?.[0]?.idempotencyKey
    await wrapper.get('[data-testid="learn-v2-upgrade"]').trigger('click')
    await vi.waitFor(() => expect(upgrade).toHaveBeenCalledTimes(2))
    expect(upgrade.mock.calls[1]?.[0]?.idempotencyKey).toBe(firstKey)
  })
})
