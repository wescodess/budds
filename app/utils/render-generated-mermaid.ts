import createDOMPurify from 'dompurify'
import { MERMAID_LIMITS, validatePassiveMermaid } from './passive-mermaid'

const svgNamespace = 'http://www.w3.org/2000/svg'
const tags = ['svg', 'g', 'defs', 'symbol', 'marker', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'clipPath']
const attributes = ['xmlns', 'id', 'class', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'text-anchor', 'dominant-baseline', 'font-size', 'font-family', 'dy', 'dx', 'marker-start', 'marker-mid', 'marker-end', 'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'orient', 'clip-path', 'preserveAspectRatio', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby']
const fragmentAttributes = new Set(['marker-start', 'marker-mid', 'marker-end', 'clip-path'])
let renderQueue: Promise<unknown> = Promise.resolve()
let sequence = 0

export function sanitizeGeneratedMermaidSvg(source: string, prefix: string, description: string): string {
  if (new TextEncoder().encode(source).length > MERMAID_LIMITS.svgBytes || !/^[a-z][\w-]*$/i.test(prefix)) throw new Error('svg-limit')
  const purifier = createDOMPurify(window)
  const config = {
    ALLOWED_TAGS: tags, ALLOWED_ATTR: attributes, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: ['foreignObject', 'a', 'image', 'use', 'script', 'animate', 'animateMotion', 'animateTransform', 'set', 'filter'],
    FORBID_ATTR: ['style'], RETURN_DOM: true as const,
  }
  const clean = purifier.sanitize(source, config)
  // Mermaid's own style sheets are replaced below. Losing teaching content or
  // other integration elements is a rejection, not a partially rendered diagram.
  if (purifier.removed.some(item => 'element' in item && item.element instanceof Element && !['body', 'style', 'filter', 'feDropShadow', 'linearGradient', 'radialGradient', 'stop'].includes(item.element.localName))) throw new Error('svg-structure')
  if (!(clean instanceof Element)) throw new Error('svg-root')
  const root = clean.querySelector('svg')
  if (!root || clean.children.length !== 1) throw new Error('svg-root')
  const elements = [root, ...root.querySelectorAll('*')]
  if (elements.length > 4096 || elements.some(el => el.namespaceURI !== svgNamespace)) throw new Error('svg-namespace')
  const ids = new Map<string, string>()
  for (const el of elements) {
    const original = el.getAttribute('id')
    if (original) {
      if (ids.has(original)) throw new Error('svg-id')
      ids.set(original, `${prefix}-${ids.size}`)
    }
  }
  for (const el of elements) {
    const actor = el.classList.contains('actor')
    const dashed = ['edge-pattern-dotted', 'edge-pattern-dashed', 'messageLine1'].some(token => el.classList.contains(token))
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name
      if (fragmentAttributes.has(name)) {
        const reference = /^url\(#([^\s()]+)\)$/.exec(attr.value)?.[1]
        if (!reference || !ids.has(reference)) throw new Error('svg-reference')
        el.setAttribute(name, `url(#${ids.get(reference)})`)
      } else if (name === 'id') el.setAttribute(name, ids.get(attr.value)!)
      else if (name === 'class' || name.startsWith('aria-') || name === 'role') el.removeAttribute(name)
      else if (name === 'fill' || name === 'stroke' || name === 'font-family' || name === 'font-size') el.removeAttribute(name)
      else if (name === 'xmlns') {
        if (attr.value !== svgNamespace) throw new Error('svg-namespace')
      } else if (!/^[\d\s.,()+eEa-zA-Z%-]*$/.test(attr.value) || /url|https?|data|javascript/i.test(attr.value)) throw new Error('svg-attribute')
    }
    // Fixed application colours replace all library/source CSS at this boundary.
    if (['rect', 'circle', 'ellipse', 'polygon'].includes(el.localName)) {
      el.setAttribute('fill', '#292524')
      el.setAttribute('stroke', actor ? '#f59e0b' : '#57534e')
    } else if (['path', 'line', 'polyline'].includes(el.localName)) {
      el.setAttribute('fill', el.closest('marker') ? '#78716c' : 'none')
      el.setAttribute('stroke', '#78716c')
      if (dashed) el.setAttribute('stroke-dasharray', '3,3')
    } else if (['text', 'tspan'].includes(el.localName)) {
      el.setAttribute('text-anchor', el.getAttribute('text-anchor') ?? 'middle')
      el.setAttribute('fill', '#d6d3d1')
      el.setAttribute('font-family', 'inherit')
      el.setAttribute('font-size', '14px')
    }
  }
  root.setAttribute('role', 'img')
  root.setAttribute('aria-label', description)
  // Mermaid expresses its natural width in CSS. Preserve that geometry without
  // retaining a style attribute; the application caps it to the viewport.
  const viewBox = root.getAttribute('viewBox')
  if (viewBox) {
    const bounds = viewBox.trim().split(/[\s,]+/).map(Number)
    if (bounds.length !== 4 || bounds.some(value => !Number.isFinite(value)) || bounds[2]! <= 0 || bounds[3]! <= 0) throw new Error('svg-viewbox')
    root.setAttribute('width', String(bounds[2]))
    root.removeAttribute('height')
  }
  // Final sanitization follows all ID rewriting and application styling. Its
  // serialized result goes straight to the sink without raw-string mutations.
  const result = purifier.sanitize(root.outerHTML, { ...config, RETURN_DOM: false })
  if (!result || new TextEncoder().encode(result).length > MERMAID_LIMITS.svgBytes) throw new Error('svg-limit')
  return result
}

type MermaidModule = typeof import('mermaid')

export function renderGeneratedMermaid(source: string, load: () => Promise<MermaidModule>, isCurrent: () => boolean): Promise<string> {
  const validated = validatePassiveMermaid(source)
  if (!validated) return Promise.reject(new Error('mermaid-source'))
  const run = renderQueue.catch(() => {}).then(async () => {
    if (!isCurrent()) throw new Error('stale')
    const module = await load()
    if (!isCurrent()) throw new Error('stale')
    const mermaid = module.default
    const current = mermaid.mermaidAPI.getConfig()
    // Keep the component's theme/layout initializer intact, including upgrades.
    mermaid.initialize({
      ...current, startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
      suppressErrorRendering: true, maxTextSize: MERMAID_LIMITS.source, maxEdges: MERMAID_LIMITS.edges,
      flowchart: { ...current.flowchart, htmlLabels: false },
      secure: [...new Set([...(current.secure ?? []), 'htmlLabels', 'flowchart', 'sequence', 'suppressErrorRendering'])],
    })
    const prefix = `generated-mermaid-${++sequence}`
    const staging = document.createElement('div')
    staging.setAttribute('aria-hidden', 'true')
    staging.dataset.generatedMermaidStaging = prefix
    Object.assign(staging.style, { position: 'fixed', left: '-100000px', visibility: 'hidden' })
    document.body.append(staging)
    try {
      const result = await mermaid.render(prefix, source, staging)
      if (!isCurrent()) throw new Error('stale')
      return sanitizeGeneratedMermaidSvg(result.svg, prefix, validated.description)
    } finally { staging.remove() }
  })
  renderQueue = run.catch(() => {})
  return run
}
