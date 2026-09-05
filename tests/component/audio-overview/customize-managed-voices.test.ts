import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

describe('AudioOverviewCustomize managed Audio Profile', () => {
  it('shows fixed Gemini Hosts and submits only effective user preferences', async () => {
    const Component = (await import('~/components/audio-overview/AudioOverviewCustomize.vue')).default
    const wrapper = mount(Component, {
      props: { open: true },
      global: {
        stubs: {
          UiDialog: { template: '<div><slot /></div>' },
          UiDialogContent: { template: '<div><slot /></div>' },
          UiDialogHeader: { template: '<div><slot /></div>' },
          UiDialogTitle: { template: '<div><slot /></div>' },
          UiDialogDescription: { template: '<div><slot /></div>' },
          UiDialogFooter: { template: '<div><slot /></div>' },
          UiDialogClose: { template: '<div><slot /></div>' },
          UiButton: { template: '<button v-bind="$attrs"><slot /></button>' },
          ChatDirectoryPicker: true,
        },
      },
    })

    const text = wrapper.text()
    expect(text).toContain('Kore')
    expect(text).toContain('Puck')
    expect(text).toContain('Managed voices')
    expect(wrapper.find('[data-testid="audio-overview-voice-a-trigger"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="audio-overview-voice-b-trigger"]').exists()).toBe(false)

    await wrapper.get('[data-testid="audio-overview-customize-submit"]').trigger('click')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      lengthMinutes: 10,
      complexity: 'beginner',
    })
  })

  it('describes quota as UTC daily reservations without promising deletion restores it', async () => {
    const Component = (await import('~/components/audio-overview/AudioOverviewCustomize.vue')).default
    const wrapper = mount(Component, {
      props: { open: true, quotaState: { used: 10, cap: 10 } },
      global: {
        stubs: {
          UiDialog: { template: '<div><slot /></div>' },
          UiDialogContent: { template: '<div><slot /></div>' },
          UiDialogHeader: { template: '<div><slot /></div>' },
          UiDialogTitle: { template: '<div><slot /></div>' },
          UiDialogDescription: { template: '<div><slot /></div>' },
          UiDialogFooter: { template: '<div><slot /></div>' },
          UiDialogClose: { template: '<div><slot /></div>' },
          UiButton: { template: '<button v-bind="$attrs"><slot /></button>' },
          ChatDirectoryPicker: true,
        },
      },
    })

    expect(wrapper.text()).toContain('midnight UTC')
    expect(wrapper.text()).toContain('daily reservation quota')
    expect(wrapper.text()).not.toContain('delete an existing overview')
  })
})
