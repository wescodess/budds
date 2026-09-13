import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const modelSelectorPath = ['~', 'components', 'chat', 'ModelSelector.vue'].join('/')

describe('ModelSelector — AC #1, #2, #3', () => {
  it('[P0] should render the current model label by default', async () => {
    const ModelSelector = await import(modelSelectorPath)

    const wrapper = await mountSuspended(ModelSelector.default, {
      props: {
        modelValue: 'openai/gpt-4o-mini',
      },
    })

    expect(wrapper.text()).toContain('GPT-4o Mini')
  })

  it('[P0] should show all models when dropdown trigger is clicked', async () => {
    const ModelSelector = await import(modelSelectorPath)

    const wrapper = await mountSuspended(ModelSelector.default, {
      props: {
        modelValue: 'openai/gpt-4o-mini',
      },
    })

    const trigger = wrapper.find('button')
    await trigger.trigger('click')
    await new Promise(r => setTimeout(r, 50))

    const items = document.querySelectorAll('[role="menuitem"]')
    expect(items.length).toBeGreaterThanOrEqual(8)
  })

  it('[P1] should mark the recommended model with "(recommended)" suffix', async () => {
    const ModelSelector = await import(modelSelectorPath)

    const wrapper = await mountSuspended(ModelSelector.default, {
      props: {
        modelValue: 'openai/gpt-4o-mini',
      },
    })

    const trigger = wrapper.find('button')
    await trigger.trigger('click')
    await new Promise(r => setTimeout(r, 50))

    const items = document.querySelectorAll('[role="menuitem"]')
    const texts = Array.from(items).map(el => el.textContent)
    expect(texts.some(t => t?.includes('(recommended)'))).toBe(true)
  })

  it('[P0] should have selectable menu items for each model', async () => {
    const ModelSelector = await import(modelSelectorPath)
    const { MODELS } = await import('~/constants/models')

    const wrapper = await mountSuspended(ModelSelector.default, {
      props: {
        modelValue: 'openai/gpt-4o-mini',
      },
    })

    const trigger = wrapper.find('button')
    await trigger.trigger('click')
    await new Promise(r => setTimeout(r, 50))

    const items = document.querySelectorAll('[role="menuitem"]')
    expect(items.length).toBeGreaterThanOrEqual(MODELS.length)

    const itemTexts = Array.from(items).map(el => el.textContent?.trim())
    for (const model of MODELS) {
      expect(itemTexts.some(t => t?.includes(model.label))).toBe(true)
    }

    const gpt4oItem = Array.from(items).find(el => el.textContent?.includes('GPT-4o') && !el.textContent?.includes('Mini'))
    expect(gpt4oItem).toBeDefined()
    expect(gpt4oItem!.getAttribute('data-disabled')).toBeNull()
  })

  it('[P1] should prevent interaction when disabled prop is true', async () => {
    const ModelSelector = await import(modelSelectorPath)

    const wrapper = await mountSuspended(ModelSelector.default, {
      props: {
        modelValue: 'openai/gpt-4o-mini',
        disabled: true,
      },
    })

    const trigger = wrapper.find('button')
    expect(trigger.attributes('disabled')).toBeDefined()
  })
})
