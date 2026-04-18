import { Motion, AnimatePresence, LayoutGroup, MotionConfig } from 'motion-v'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component('Motion', Motion)
  nuxtApp.vueApp.component('AnimatePresence', AnimatePresence)
  nuxtApp.vueApp.component('LayoutGroup', LayoutGroup)
  nuxtApp.vueApp.component('MotionConfig', MotionConfig)
})
