import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, h, Suspense } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useNuxtApp } from '#app'
import MDCRenderer from '@nuxtjs/mdc/runtime/components/MDCRenderer.vue'
import TextBlock from '~/components/learn/TextBlock.vue'
import Message from '~/components/chat/Message.vue'
import { costlySyntaxClasses, parserStallSources, permittedSourceLength } from '../support/generated-markdown-resources'

const parser = vi.hoisted(() => ({ reached: vi.fn(), forbidden: false }))
vi.mock('@nuxtjs/mdc/runtime', async (original) => {
  const actual = await original<typeof import('@nuxtjs/mdc/runtime')>()
  return { ...actual, parseMarkdown: (...args: Parameters<typeof actual.parseMarkdown>) => {
    if (parser.forbidden) { parser.reached(); throw new Error('parser reached') }
    return actual.parseMarkdown(...args)
  } }
})
const refusedClasses: Array<[string, string]> = [
  ['braces', '{}'.repeat(30_000)],
  ...costlySyntaxClasses.filter(([name]) => ['plus run', 'dotted words', 'escaped openers', 'bullets', 'headings', 'mixed grammar'].includes(name)).map(([name, build]): [string, string] => [name, build(permittedSourceLength)]),
  ...parserStallSources,
]
const escapedSsrText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

describe('generated content during server rendering', () => {
  it.each(refusedClasses)('emits complete escaped text for %s at both sinks without reaching the parser', async (_name, content) => {
    parser.forbidden = true
    parser.reached.mockClear()
    try {
      for (const component of [TextBlock, Message]) {
        const app = createSSRApp({ render: () => h(component, { content, role: 'assistant', animate: false }) })
        Object.assign(app, { $nuxt: useNuxtApp() })
        app.component('MDCRenderer', MDCRenderer)
        app.component('Motion', { setup: (_, { slots }) => () => h('div', slots.default?.()) })
        const output = await renderToString(app)
        expect(output).toContain(escapedSsrText(content))
        expect(output).not.toContain('data-generated-refused')
        expect(parser.reached).not.toHaveBeenCalled()
      }
    } finally { parser.forbidden = false }
  })

  it.each(['course', 'chat'] as const)('%s emits complete escaped text for over-budget syntax', async (surface) => {
    const content = '{}'.repeat(30_000)
    const component = surface === 'course' ? TextBlock : Message
    const app = createSSRApp({ render: () => h(component, { content, role: 'assistant', animate: false }) })
    Object.assign(app, { $nuxt: useNuxtApp() })
    app.component('MDCRenderer', MDCRenderer)
    app.component('Motion', { setup: (_, { slots }) => () => h('div', slots.default?.()) })
    const output = await renderToString(app)
    expect(output).toContain(content)
    expect(output).not.toContain('data-generated-refused')
  })

  it.each(['course', 'chat'] as const)('%s waits for the same gate before emitting markup', async (surface) => {
    for (const content of ['Ordinary **lesson**', '---\ncomponent:\n  props:\n    id: metadata-canary\n---\nReadable canary', '<b title="canary">Readable canary</b>', '```mermaid\ngraph TD\naccDescr: Start leads to Finish.\nA[Start] --> B[Finish]\n```']) {
      const component = surface === 'course' ? TextBlock : Message
      const app = createSSRApp({ render: () => h(component, { content, role: 'assistant', animate: false }) })
      Object.assign(app, { $nuxt: useNuxtApp() })
      app.component('MDCRenderer', MDCRenderer)
      app.component('Motion', { setup: (_, { slots }) => () => h('div', slots.default?.()) })
      const output = await renderToString(app)
      if (content.startsWith('Ordinary')) expect(output).toContain('<strong>lesson</strong>')
      else if (content.startsWith('```')) {
        expect(output).toContain('Start leads to Finish.')
        expect(output).toContain('graph TD')
        expect(output).not.toMatch(/<svg[^>]*role="img"/)
      } else {
        expect(output).toContain('Readable canary')
        expect(output).not.toContain('id="metadata-canary"')
        expect(output).not.toContain('<b title=')
      }
    }
  })

  it.each(['course', 'chat'] as const)('%s hydrates the same gated output without a mismatch', async (surface) => {
    const component = surface === 'course' ? TextBlock : Message
    const nuxt = useNuxtApp()
    const create = () => {
      const app = createSSRApp({ render: () => h(Suspense, null, { default: () => h(component, { content: 'Ordinary **lesson**', role: 'assistant', animate: false }) }) })
      Object.assign(app, { $nuxt: nuxt })
      app.component('MDCRenderer', MDCRenderer)
      app.component('Motion', { setup: (_, { slots }) => () => h('div', slots.default?.()) })
      return app
    }
    const host = document.createElement('main')
    host.innerHTML = await renderToString(create())
    document.body.append(host)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = create()
    try {
      app.mount(host)
      await vi.waitFor(() => expect(host.querySelector('strong')?.textContent).toBe('lesson'))
      expect(warning.mock.calls.flat().join(' ')).not.toContain('Hydration')
    } finally { app.unmount(); host.remove(); warning.mockRestore() }
  })
})
