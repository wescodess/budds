const MIRROR_STYLE_PROPS = [
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'borderTopWidth',
  'boxSizing',
  'fontFamily',
  'fontFeatureSettings',
  'fontKerning',
  'fontSize',
  'fontStretch',
  'fontStyle',
  'fontVariant',
  'fontVariantLigatures',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'tabSize',
  'textIndent',
  'textTransform',
  'whiteSpace',
  'wordBreak',
  'wordSpacing',
  'overflowWrap',
] as const

export function getTextareaCaretPosition(textarea: HTMLTextAreaElement, position: number) {
  const mirror = document.createElement('div')
  const marker = document.createElement('span')
  const style = getComputedStyle(textarea)

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordBreak = 'break-word'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  mirror.style.width = `${textarea.clientWidth}px`

  for (const prop of MIRROR_STYLE_PROPS) {
    mirror.style[prop] = style[prop]
  }

  mirror.textContent = textarea.value.slice(0, position)
  marker.textContent = textarea.value.slice(position) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const left = marker.offsetLeft - textarea.scrollLeft
  const top = marker.offsetTop - textarea.scrollTop
  const lineHeight = Number.parseFloat(style.lineHeight) || 20

  document.body.removeChild(mirror)

  return { left, top, lineHeight }
}
