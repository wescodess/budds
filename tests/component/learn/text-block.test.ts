import { describe, it, expect, beforeAll } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const componentPath = ['~', 'components', 'learn', 'TextBlock.vue'].join('/')

beforeAll(async () => {
  const { parseMarkdown } = await import('@nuxtjs/mdc/runtime')
  await parseMarkdown('warm-up')
  try {
    await parseMarkdown('```ts\nx\n```', { toc: false, contentHeading: false })
  } catch {
    await parseMarkdown('```ts\nx\n```', { toc: false, contentHeading: false, highlight: false })
  }
})

async function mountTextBlock(content: string) {
  const Comp = await import(componentPath)
  const wrapper = await mountSuspended(Comp.default, {
    props: { content },
  })
  for (let i = 0; i < 5; i++) {
    await flushPromises()
  }
  return wrapper
}

describe('TextBlock', () => {
  it('renders markdown content', async () => {
    const wrapper = await mountTextBlock('This is a test paragraph.')
    expect(wrapper.text()).toContain('This is a test paragraph.')
  })

  it('renders bold text', async () => {
    const wrapper = await mountTextBlock('This is **bold** text.')
    const strong = wrapper.find('strong')
    expect(strong.exists()).toBe(true)
    expect(strong.text()).toBe('bold')
  })

  it('renders headings', async () => {
    const wrapper = await mountTextBlock('## Section Heading')
    const heading = wrapper.find('h2')
    expect(heading.exists()).toBe(true)
    expect(heading.text()).toBe('Section Heading')
  })

  it('renders unordered lists', async () => {
    const wrapper = await mountTextBlock('- Item one\n- Item two')
    const items = wrapper.findAll('li')
    expect(items.length).toBe(2)
  })

  it('renders numbered lists as ol elements', async () => {
    const wrapper = await mountTextBlock('1. First item\n2. Second item\n3. Third item')
    const ol = wrapper.find('ol')
    expect(ol.exists()).toBe(true)
    const items = ol.findAll('li')
    expect(items.length).toBe(3)
    expect(items[0].text()).toContain('First item')
    expect(items[1].text()).toContain('Second item')
    expect(items[2].text()).toContain('Third item')
  })

  it('renders fenced code blocks as pre elements', async () => {
    const wrapper = await mountTextBlock('```\nconst x = 1;\nconsole.log(x);\n```')
    const pre = wrapper.find('pre')
    expect(pre.exists()).toBe(true)
    const code = pre.find('code')
    expect(code.exists()).toBe(true)
    expect(code.text()).toContain('const x = 1;')
  })

  it('renders fenced code blocks with language hint', async () => {
    const wrapper = await mountTextBlock('```typescript\nfunction add(a: number, b: number): number {\n  return a + b;\n}\n```')
    const pre = wrapper.find('pre')
    expect(pre.exists()).toBe(true)
    expect(pre.text()).toContain('function add')
  })

  it('renders inline code alongside fenced code blocks', async () => {
    const wrapper = await mountTextBlock('Use `console.log()` for debugging.\n\n```\nconst result = add(1, 2);\n```')
    const inlineCode = wrapper.find('p code')
    expect(inlineCode.exists()).toBe(true)
    expect(inlineCode.text()).toContain('console.log()')
    const pre = wrapper.find('pre')
    expect(pre.exists()).toBe(true)
  })

  it('shows explanation label', async () => {
    const wrapper = await mountTextBlock('Test content')
    expect(wrapper.text()).toContain('Explanation')
  })

  it('handles empty content', async () => {
    const wrapper = await mountTextBlock('')
    expect(wrapper.find('[data-testid="text-block"]').exists()).toBe(true)
  })
})
