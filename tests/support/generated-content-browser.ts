import * as Vue from 'vue'
import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import MDCRenderer from '@nuxtjs/mdc/runtime/components/MDCRenderer.vue'
import TextBlock from '../../app/components/learn/TextBlock.vue'
import Message from '../../app/components/chat/Message.vue'
import MermaidDiagram from '../../app/components/global/MermaidDiagram.vue'
import Citation from '../../app/components/global/Citation.vue'
import { parseGeneratedMarkdown } from '../../app/utils/generated-markdown'
import { renderGeneratedMermaid, sanitizeGeneratedMermaidSvg } from '../../app/utils/render-generated-mermaid'

Object.assign(globalThis, Vue, {
  useRequestURL: () => new URL('https://budds-ci.invalid'),
  useRuntimeConfig: () => ({ public: { siteUrl: 'https://budds-ci.invalid' } }),
  useMotionPresets: () => ({ springSnappy: {} }),
})

let app: Vue.App | undefined
let props: { content: string; code: string } | undefined
function unmount() {
  app?.unmount()
  app = undefined
  document.querySelector('#host')?.remove()
}
function mount(surface: 'course' | 'chat' | 'mermaid', content: string) {
  unmount()
  const host = document.createElement('main')
  host.id = 'host'
  document.body.append(host)
  props = Vue.reactive({ content, code: content })
  const component = surface === 'course' ? TextBlock : surface === 'chat' ? Message : MermaidDiagram
  app = Vue.createApp({ render: () => Vue.h(Vue.Suspense, null, { default: () => Vue.h(component, { ...props, role: 'assistant', animate: false, sources: [{ filename: 'notes.pdf', content: 'Reference context.', score: 1 }] }) }) })
  app.component('MDCRenderer', MDCRenderer)
  app.component('MermaidDiagram', MermaidDiagram)
  app.component('Citation', Citation)
  // Decorative shell adapters; content components and all security boundaries run.
  const shell = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) })
  app.component('ClientOnly', shell)
  app.component('Motion', shell)
  app.component('UiSkeleton', shell)
  app.component('ChatCitationBadge', Vue.defineComponent({ props: ['index'], setup: p => () => Vue.h('button', String(p.index)) }))
  app.mount(host)
}
const harness = {
  parseMarkdown, parseGeneratedMarkdown, renderGeneratedMermaid, sanitizeGeneratedMermaidSvg, mount, unmount,
  update(content: string) { if (props) { props.content = content; props.code = content } },
}
Object.assign(globalThis, { __generatedContentTest: harness })
declare global { interface Window { __generatedContentTest: typeof harness } }
