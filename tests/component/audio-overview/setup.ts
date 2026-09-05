import { config } from '@vue/test-utils'
import { computed, defineComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'

Object.assign(globalThis, {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
})

const Passthrough = defineComponent({
  template: '<div><slot /></div>',
})

config.global.stubs = {
  NuxtLink: defineComponent({
    props: { to: { type: [String, Object], required: false } },
    template: '<a :href="typeof to === \'string\' ? to : \'#\'"><slot /></a>',
  }),
  UiAlertDialog: Passthrough,
  UiAlertDialogAction: Passthrough,
  UiAlertDialogCancel: Passthrough,
  UiAlertDialogContent: Passthrough,
  UiAlertDialogDescription: Passthrough,
  UiAlertDialogFooter: Passthrough,
  UiAlertDialogHeader: Passthrough,
  UiAlertDialogTitle: Passthrough,
  AudioOverviewSyncedTranscript: defineComponent({
    name: 'AudioOverviewSyncedTranscript',
    props: ['turns', 'currentTurnIndex', 'currentTimeSec', 'isPlaying'],
    template: '<div data-testid="mounted-synced-transcript">{{ turns?.[currentTurnIndex]?.text }}</div>',
  }),
}
