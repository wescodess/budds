import AxeBuilder from '@axe-core/playwright'

export async function checkPage(page, surface) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const violations = axe.violations.flatMap(rule => rule.nodes.map(node => ({
    rule: `axe/${rule.id}`,
    selector: node.target,
    message: node.failureSummary || rule.help,
    impact: rule.impact,
    helpUrl: rule.helpUrl,
  })))
  const layout = await page.evaluate(() => {
    function selectorFor(element) {
      if (element.id) return `#${CSS.escape(element.id)}`
      const testId = element.getAttribute('data-testid')
      if (testId && document.querySelectorAll(`[data-testid="${CSS.escape(testId)}"]`).length === 1) return `[data-testid="${CSS.escape(testId)}"]`
      const parts = []
      for (let current = element; current; current = current.parentElement) {
        const siblings = current.parentElement ? [...current.parentElement.children].filter(value => value.tagName === current.tagName) : [current]
        parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`)
      }
      return parts.join(' > ')
    }
    const visible = element => element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && element.getClientRects().length > 0
    const findings = []
    const width = document.documentElement.clientWidth
    if (Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > width + 1) {
      const offenders = [...document.body.querySelectorAll('*')].filter(element => {
        if (!visible(element)) return false
        const rect = element.getBoundingClientRect()
        return rect.right > width + 1 || rect.left < -1
      })
      for (const element of offenders.length ? offenders : [document.documentElement]) {
        findings.push({ rule: 'horizontal-overflow', selector: selectorFor(element), message: `Content exceeds the ${width}px viewport` })
      }
    }
    // A stricter size floor supplements axe's WCAG 2.2 spacing exceptions.
    const interactive = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="slider"], [role="combobox"], [contenteditable="true"]'
    for (const element of document.querySelectorAll(`${interactive}, [tabindex]`)) {
      if (!element.matches(interactive) && element.tabIndex < 0) continue
      if (!visible(element) || element.matches(':disabled, [aria-disabled="true"], [inert] *')) continue
      const rects = [...element.getClientRects()]
      if (rects.every(rect => rect.width >= 24 && rect.height >= 24)) continue
      findings.push({ rule: 'target-size-24', selector: selectorFor(element), message: 'Interactive target is smaller than 24 × 24 CSS pixels', rects: rects.map(({ width, height }) => ({ width, height })) })
    }
    return findings
  })
  const separation = await page.evaluate(pairs => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Cannot resolve background fills')
    function background(selector) {
      const elements = document.querySelectorAll(selector)
      if (elements.length !== 1 || !elements[0].checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) throw new Error(`Surface separation requires exactly one visible element: ${selector}`)
      const chain = []
      for (let element = elements[0]; element; element = element.parentElement) chain.unshift(element)
      let color = [255, 255, 255]
      for (const element of chain) {
        const style = getComputedStyle(element)
        if (style.backgroundImage !== 'none' || Number(style.opacity) !== 1 || style.mixBlendMode !== 'normal' || style.filter !== 'none' || style.backdropFilter !== 'none') throw new Error(`Unsupported non-flat background at ${selector}`)
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = style.backgroundColor
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b, alpha] = ctx.getImageData(0, 0, 1, 1).data
        color = [r, g, b].map((channel, index) => channel * alpha / 255 + color[index] * (1 - alpha / 255))
      }
      return color
    }
    function luminance(color) {
      return color.map(channel => channel / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    }
    return pairs.flatMap(pair => {
      const fills = pair.selectors.map(background)
      const values = fills.map(luminance)
      const ratio = (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
      return ratio >= pair.minContrast ? [] : [{ rule: 'surface-separation', selector: pair.selectors, message: `Background contrast ${ratio.toFixed(4)} is below ${pair.minContrast}`, ratio, minimum: pair.minContrast, fills }]
    })
  }, surface.surfaceSeparation)
  return { violations: [...violations, ...layout, ...separation], incomplete: axe.incomplete.map(rule => ({ rule: rule.id, targets: rule.nodes.map(node => node.target) })), axeVersion: axe.testEngine.version }
}
