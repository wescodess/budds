import { markRaw } from 'vue'
import type MDCRenderer from '@nuxtjs/mdc/runtime/components/MDCRenderer.vue'
import Citation from '~/components/global/Citation.vue'
import ProsePre from '~/components/global/ProsePre.vue'

// Explicit instances override global mappings for the only admitted components.
// MDC's component type erases required props; this assertion is confined to the
// fixed, imported registry. The gate constructs each component's props itself.
export const generatedMdcComponents = Object.freeze({
  citation: markRaw(Citation),
  pre: markRaw(ProsePre),
}) as unknown as NonNullable<InstanceType<typeof MDCRenderer>['$props']['components']>
