import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

describe('AudioOverviewGenerating', () => {
  it('recognizes Scene progress from the v2 Workflow', async () => {
    const Component = (await import('~/components/audio-overview/AudioOverviewGenerating.vue')).default
    const wrapper = mount(Component, {
      props: {
        taskId: 'task_1' as any,
        progress: 'Rendering scene 2/4…',
      },
    })

    expect(wrapper.text()).toContain('Rendering audio')
    expect(wrapper.text()).toContain('60%')
  })
})
