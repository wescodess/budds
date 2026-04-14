import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createSource } from '../../support/factories/chat.factory'

const sourceCardPath = ['~', 'components', 'chat', 'SourceCard.vue'].join('/')

describe('SourceCard — AC #5', () => {
  it('[P0] should render citation number, filename, and passage text', async () => {
    const SourceCard = await import(sourceCardPath)
    const source = createSource({ content: 'Mitochondria is the powerhouse of the cell', filename: 'biology.pdf' })

    const wrapper = await mountSuspended(SourceCard.default, {
      props: {
        index: 1,
        filename: source.filename,
        content: source.content,
        score: source.score,
      },
    })

    expect(wrapper.text()).toContain('1')
    expect(wrapper.text()).toContain('biology.pdf')
    expect(wrapper.text()).toContain('Mitochondria is the powerhouse of the cell')
  })

  it('[P0] should render relevance score as a percentage badge', async () => {
    const SourceCard = await import(sourceCardPath)

    const wrapper = await mountSuspended(SourceCard.default, {
      props: {
        index: 1,
        filename: 'notes.pdf',
        content: 'Some passage text',
        score: 0.87,
      },
    })

    expect(wrapper.text()).toContain('87%')
  })

  it('[P0] should render passage text in monospace font', async () => {
    const SourceCard = await import(sourceCardPath)

    const wrapper = await mountSuspended(SourceCard.default, {
      props: {
        index: 1,
        filename: 'notes.pdf',
        content: 'Passage in mono',
        score: 0.9,
      },
    })

    const passage = wrapper.find('.font-mono')
    expect(passage.exists()).toBe(true)
    expect(passage.text()).toContain('Passage in mono')
  })

  it('[P0] should have correct aria-label with filename', async () => {
    const SourceCard = await import(sourceCardPath)

    const wrapper = await mountSuspended(SourceCard.default, {
      props: {
        index: 2,
        filename: 'genetics.pdf',
        content: 'DNA content',
        score: 0.92,
      },
    })

    const card = wrapper.find('[aria-label]')
    expect(card.attributes('aria-label')).toBe('Source passage from genetics.pdf')
  })

  it('[P1] should apply highlighted ring/border when highlighted prop is true', async () => {
    const SourceCard = await import(sourceCardPath)

    const wrapper = await mountSuspended(SourceCard.default, {
      props: {
        index: 1,
        filename: 'notes.pdf',
        content: 'Highlighted passage',
        score: 0.85,
        highlighted: true,
      },
    })

    const card = wrapper.find('[aria-label]')
    expect(card.classes()).toEqual(expect.arrayContaining([expect.stringContaining('ring')]))
  })

  it('[P1] should not apply highlight ring when highlighted is false or absent', async () => {
    const SourceCard = await import(sourceCardPath)

    const wrapper = await mountSuspended(SourceCard.default, {
      props: {
        index: 1,
        filename: 'notes.pdf',
        content: 'Normal passage',
        score: 0.8,
      },
    })

    const card = wrapper.find('[aria-label]')
    const classes = card.classes().join(' ')
    expect(classes).not.toContain('ring')
  })
})
