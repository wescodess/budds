import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const thinkingRowPath = ['~', 'components', 'chat', 'ThinkingRow.vue'].join('/')

describe('ChatThinkingRow', () => {
  it('renders Thinking… text and status role', async () => {
    const ThinkingRow = await import(thinkingRowPath)
    const wrapper = await mountSuspended(ThinkingRow.default)
    expect(wrapper.text()).toContain('Thinking')
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.attributes('aria-live')).toBe('polite')
  })

  it('includes model label when model prop provided', async () => {
    const ThinkingRow = await import(thinkingRowPath)
    const wrapper = await mountSuspended(ThinkingRow.default, {
      props: { model: 'openai/gpt-5' },
    })
    expect(wrapper.text().toLowerCase()).toContain('reasoning')
  })
})
