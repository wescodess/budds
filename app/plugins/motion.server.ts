import { defineComponent, h } from 'vue'

const MOTION_PROPS = new Set([
  'initial', 'animate', 'exit', 'transition', 'variants',
  'whileHover', 'whileTap', 'whileDrag', 'whileFocus', 'whileInView',
  'layout', 'layoutId', 'layoutDependency', 'layoutScroll',
  'drag', 'dragConstraints', 'dragElastic', 'dragMomentum',
  'onAnimationStart', 'onAnimationComplete', 'onUpdate',
  'as',
])

function filterAttrs(attrs: Record<string, unknown>) {
  const filtered: Record<string, unknown> = {}
  for (const key in attrs) {
    if (!MOTION_PROPS.has(key)) {
      filtered[key] = attrs[key]
    }
  }
  return filtered
}

const PassthroughComponent = defineComponent({
  name: 'MotionPassthrough',
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => {
      const tag = (attrs.as as string) || 'div'
      const children = slots.default?.()
      return h(tag, filterAttrs(attrs), children)
    }
  },
})

const FragmentComponent = defineComponent({
  setup(_, { slots }) {
    return () => slots.default?.()
  },
})

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component('Motion', PassthroughComponent)
  nuxtApp.vueApp.component('AnimatePresence', FragmentComponent)
  nuxtApp.vueApp.component('LayoutGroup', FragmentComponent)
  nuxtApp.vueApp.component('MotionConfig', FragmentComponent)
})
