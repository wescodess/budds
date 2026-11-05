import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TextBlock from '~/components/learn/TextBlock.vue'
import Message from '~/components/chat/Message.vue'
import { GENERATED_MARKDOWN_LIMITS, generatedTextFallback, parseGeneratedMarkdown } from '~/utils/generated-markdown'
import { normalizeAssistantCitations } from '~/utils/normalize-assistant-citations'
import { createSources } from '../support/factories/chat.factory'

const parser = vi.hoisted(() => ({ calls: vi.fn() }))
vi.mock('@nuxtjs/mdc/runtime', async (original) => {
  const actual = await original<typeof import('@nuxtjs/mdc/runtime')>()
  return { ...actual, parseMarkdown: (...args: Parameters<typeof actual.parseMarkdown>) => {
    parser.calls()
    return actual.parseMarkdown(...args)
  } }
})

const context = { applicationOrigins: ['https://budds-ci.invalid'], sourceCount: 2 }
const denseSource = '{}'.repeat(30_000)
const literalText = (segments: ReturnType<typeof generatedTextFallback>) => segments.map(segment => segment.type === 'text' ? segment.value : `[${segment.index}]`).join('')

afterEach(() => { vi.restoreAllMocks(); parser.calls.mockClear() })

describe('generated Markdown resource bounds', () => {
  it.each([
    denseSource,
    '['.repeat(60_000),
    `${'Prose '.repeat(9_900)}${'{} '.repeat(200)}`,
    `${'Plain\n'.repeat(8_000)}${'{}\n'.repeat(1_000)}`,
  ])('rejects excessive syntax work before invoking MDC', async (source) => {
    expect(source.length).toBeLessThan(GENERATED_MARKDOWN_LIMITS.source)
    const result = await parseGeneratedMarkdown(source, context)
    expect(parser.calls).not.toHaveBeenCalled()
    expect(result.body).toBeNull()
    expect(result.tailRefused).toBe(false)
    expect(literalText(result.fallback)).toBe(source)
    expect(normalizeAssistantCitations(source)).toBe(source)
  })

  it('keeps the full source allowance for ordinary prose with formatting and citations', async () => {
    const source = '# Topic\n\n**Lesson** [1]\n\n'.padEnd(GENERATED_MARKDOWN_LIMITS.source, 'x')
    const result = await parseGeneratedMarkdown(source, context)
    expect(parser.calls).toHaveBeenCalledOnce()
    expect(result.body).not.toBeNull()
    expect(JSON.stringify(result.body)).toContain('"tag":"strong"')
    expect(JSON.stringify(result.body)).toContain('"tag":"citation"')
    // Successful rich output does not also scan the complete document for fallback.
    expect(result.fallback).toEqual([])
  })

  it('enforces the syntax-work boundary independently of syntax placement', async () => {
    const length = 10_000
    const pairs = GENERATED_MARKDOWN_LIMITS.syntaxWork / length / 2
    await parseGeneratedMarkdown('{}'.repeat(pairs).padEnd(length, 'x'), context)
    expect(parser.calls).toHaveBeenCalledOnce()
    parser.calls.mockClear()
    await parseGeneratedMarkdown('{}'.repeat(pairs + 1).padStart(length, 'x'), context)
    expect(parser.calls).not.toHaveBeenCalled()
  })

  it.each([TextBlock, Message])('falls back through the real sink without invoking MDC, then recovers', async (component) => {
    const content = `${denseSource}\nFact [1]`
    const wrapper = await mountSuspended(component, { props: { role: 'assistant', content, sources: createSources(1), animate: false, streaming: true } })
    try {
      expect(parser.calls).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain(denseSource)
      expect(wrapper.find('pre, strong, [data-generated-refused]').exists()).toBe(false)
      if (component === Message) expect(wrapper.findAll('button[aria-label^="Source 1"]')).toHaveLength(1)
      await wrapper.setProps({ content: 'Recovered **lesson**', streaming: false })
      await vi.waitFor(() => expect(wrapper.find('strong').text()).toBe('lesson'))
    } finally { wrapper.unmount() }
  })

  it('rejects successive over-budget chat chunks and stream completion before MDC', async () => {
    const prefix = 'Initial **lesson**\n\n'
    const wrapper = await mountSuspended(Message, { props: { role: 'assistant', content: prefix, sources: createSources(1), animate: false, streaming: true } })
    try {
      expect(wrapper.find('strong').text()).toBe('lesson')
      parser.calls.mockClear()
      for (const length of [4_000, 16_000, 60_000]) {
        const content = prefix + denseSource.slice(0, length)
        await wrapper.setProps({ content })
        await vi.waitFor(() => expect(wrapper.find('strong').exists()).toBe(false))
        expect(wrapper.text()).toContain(content)
      }
      await wrapper.setProps({ streaming: false })
      expect(parser.calls).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="streaming-cursor"]').exists()).toBe(false)
    } finally { wrapper.unmount() }
  })
})

describe('fallback scanner work', () => {
  it.each([2_000, 8_000, 29_980])('indexes nested delimiters with linear reads and slices at depth %i', (depth) => {
    const source = `${'['.repeat(depth)}Fact [1]${']'.repeat(depth)} tail [2]`
    const original = String.prototype.slice
    let sliced = 0
    const reads = vi.spyOn(String.prototype, 'charCodeAt')
    vi.spyOn(String.prototype, 'slice').mockImplementation(function (this: string, start, end) {
      const result = original.call(this, start, end)
      if (this === source) sliced += result.length
      return result
    })
    const segments = generatedTextFallback(source, 2)
    const readCount = reads.mock.calls.length
    vi.restoreAllMocks()
    expect(segments.filter(segment => segment.type === 'citation')).toEqual([{ type: 'citation', index: 1 }, { type: 'citation', index: 2 }])
    expect(literalText(segments)).toBe(source)
    expect(readCount).toBe(source.length * 2)
    expect(sliced).toBeLessThan(source.length * 4)
  })

  it('bounds normalization of overlapping reference labels and preserves the complete literal source', () => {
    const source = `${'['.repeat(8_000)}Source 1${']'.repeat(8_000)}.\n\n[r]: https://example.invalid\nTail (Source 2)`
    const original = String.prototype.slice
    let sliced = 0
    vi.spyOn(String.prototype, 'slice').mockImplementation(function (this: string, start, end) {
      const result = original.call(this, start, end)
      if (this === source) sliced += result.length
      return result
    })
    const segments = generatedTextFallback(source, 2)
    vi.restoreAllMocks()
    expect(segments).toEqual([{ type: 'text', value: source }])
    expect(sliced).toBeLessThan(source.length * 6)
    expect(normalizeAssistantCitations(source)).toBe(source)
  })

  it.each([
    '[outer [label [1]](https://example.invalid/[2])] Tail [2]',
    '[label [1]](https://example.invalid/(nested)/[2]) Tail [2]',
    '[label [1]][ref]\n\n[ref]: https://example.invalid/[1]\nTail [2]',
    '[label [1]] [ref]\n\n[ref]: https://example.invalid\nTail [2]',
    '`[1]` <b>[1]</b>\nTail [2]',
    '[label \\] [1]](https://example.invalid) Tail [2]',
  ])('protects code, markup and nested or escaped link syntax in %j', (source) => {
    const segments = generatedTextFallback(source, 2)
    expect(segments.filter(segment => segment.type === 'citation')).toEqual([{ type: 'citation', index: 2 }])
    expect(literalText(segments)).toBe(source)
  })

  it.each(['[label [1]', '[label [1]](unfinished [2]', '`unfinished [1]', '```text\n[1]'])('keeps unmatched syntax literal in %j', (source) => {
    expect(generatedTextFallback(source, 2)).toEqual([{ type: 'text', value: source }])
    expect(normalizeAssistantCitations(source)).toBe(source)
  })
})
