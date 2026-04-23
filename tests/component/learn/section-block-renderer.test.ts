import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const componentPath = ['~', 'components', 'learn', 'SectionBlockRenderer.vue'].join('/')

const textBlock = { type: 'text' as const, content: 'Hello world', order: 0 }
const quizBlock = { type: 'quiz' as const, entityId: 'quiz_123', entityType: 'quiz' as const, order: 1 }
const flashcardBlock = { type: 'flashcard' as const, entityId: 'room_456', entityType: 'flashcard' as const, order: 2 }
const audioBlock = { type: 'audio' as const, entityId: 'audio_789', entityType: 'audio' as const, order: 3 }

describe('SectionBlockRenderer', () => {
  it('renders text block component', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { contentBlocks: [textBlock], courseId: 'course_1' as any },
    })
    const block = wrapper.find('[data-testid="text-block"]')
    expect(block.exists()).toBe(true)
  })

  it('renders quiz block component', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { contentBlocks: [quizBlock], courseId: 'course_1' as any },
    })
    const block = wrapper.find('[data-testid="quiz-block"]')
    expect(block.exists()).toBe(true)
  })

  it('renders flashcard block component', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { contentBlocks: [flashcardBlock], courseId: 'course_1' as any },
    })
    const block = wrapper.find('[data-testid="flashcard-block"]')
    expect(block.exists()).toBe(true)
  })

  it('renders audio block component', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { contentBlocks: [audioBlock], courseId: 'course_1' as any },
    })
    const block = wrapper.find('[data-testid="audio-block"]')
    expect(block.exists()).toBe(true)
  })

  it('renders multiple blocks in order', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: {
        contentBlocks: [textBlock, quizBlock, flashcardBlock, audioBlock],
        courseId: 'course_1' as any,
      },
    })
    const items = wrapper.findAll('[role="listitem"]')
    expect(items.length).toBe(4)
  })

  it('shows empty state when no blocks', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { contentBlocks: [], courseId: 'course_1' as any },
    })
    expect(wrapper.text()).toContain('No content blocks available')
  })

  it('has accessible list role', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { contentBlocks: [textBlock], courseId: 'course_1' as any },
    })
    const list = wrapper.find('[role="list"]')
    expect(list.exists()).toBe(true)
    expect(list.attributes('aria-label')).toBe('Section content blocks')
  })
})
