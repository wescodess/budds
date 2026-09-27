import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const path = ['~', 'components', 'learn-adaptive', 'IntentChips.vue'].join('/')

describe('learning intent chips', () => {
  it('offers exactly six keyboard buttons and exposes one pressed selection', async () => {
    const component = await import(path)
    const wrapper = await mountSuspended(component.default, { props: { modelValue: 'understand' } })
    const chips = wrapper.findAll('[data-testid^="learn-intent-chip-"]')
    expect(chips.map(chip => chip.text())).toEqual(['Understand', 'Prepare', 'Build or solve', 'Master', 'Refresh', 'Explore'])
    expect(chips.every(chip => chip.element.tagName === 'BUTTON' && chip.attributes('type') === 'button' && chip.classes().includes('min-h-11'))).toBe(true)
    expect(chips.filter(chip => chip.attributes('aria-pressed') === 'true')).toHaveLength(1)
    expect(wrapper.get('fieldset legend').text()).toBe('Learning intent')
    await wrapper.get('[data-testid="learn-intent-chip-build"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['build'])
    await wrapper.setProps({ modelValue: 'build' })
    expect(wrapper.findAll('[aria-pressed="true"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="learn-intent-chip-build"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[role="status"]').text()).toContain('Build or solve')
  })

  it('keeps a focused chip in the tab order while a save is busy and ignores repeat activation', async () => {
    const component = await import(path)
    const host = document.createElement('div')
    document.body.append(host)
    const wrapper = await mountSuspended(component.default, { attachTo: host, props: { modelValue: 'explore', disabled: false } })
    try {
      const chip = wrapper.get('[data-testid="learn-intent-chip-explore"]')
      ;(chip.element as HTMLButtonElement).focus()
      await wrapper.setProps({ disabled: true })
      expect(document.activeElement).toBe(chip.element)
      expect(chip.attributes('disabled')).toBeUndefined()
      expect(chip.attributes('aria-disabled')).toBe('true')
      await chip.trigger('click')
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      await wrapper.setProps({ disabled: false })
      expect(document.activeElement).toBe(chip.element)
      await chip.trigger('click')
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['explore'])
    }
    finally { wrapper.unmount(); host.remove() }
  })
})
