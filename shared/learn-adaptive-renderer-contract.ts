import {
  ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
  ADAPTIVE_ACTIVITY_RENDERER_VERSION,
  adaptiveActivityFallbackForReason,
  validateAdaptiveActivityPrimitive,
  type AdaptiveActivityEvidenceContext,
  type AdaptiveActivityPrimitiveType,
  type AdaptiveActivityValidationReason,
  type ValidatedAdaptiveActivityPrimitive,
} from './learn-adaptive-activity-registry'

export type AdaptiveActivityRenderer = 'ready_session' | 'diagnostic' | 'artifact' | 'reflection'

function exhaustivePrimitive(value: never): never {
  throw new Error(`No Canvas renderer for ${String(value)}`)
}

// This dispatch is deliberately separate from the descriptor. A registry addition
// must be assigned to a real Canvas branch before it can typecheck.
export function canvasRendererForPrimitive(type: AdaptiveActivityPrimitiveType): AdaptiveActivityRenderer {
  switch (type) {
    case 'cited_explanation':
    case 'worked_example':
    case 'independent_application':
    case 'source_comparison': return 'ready_session'
    case 'diagnostic_prompt': return 'diagnostic'
    case 'artifact_workspace': return 'artifact'
    case 'reflection_next_move': return 'reflection'
    default: return exhaustivePrimitive(type)
  }
}

// A new registry type must acquire a renderer, fallback, and accessible name here.
export const ADAPTIVE_ACTIVITY_RENDERERS = {
  cited_explanation: { renderer: 'ready_session', fallback: 'learn-activity-fallback', accessibleName: 'Cited explanation' },
  diagnostic_prompt: { renderer: 'diagnostic', fallback: 'learn-activity-fallback', accessibleName: 'Diagnostic prompt' },
  worked_example: { renderer: 'ready_session', fallback: 'learn-activity-fallback', accessibleName: 'Worked example' },
  independent_application: { renderer: 'ready_session', fallback: 'learn-activity-fallback', accessibleName: 'Independent application' },
  source_comparison: { renderer: 'ready_session', fallback: 'learn-activity-fallback', accessibleName: 'Source comparison' },
  artifact_workspace: { renderer: 'artifact', fallback: 'learn-activity-fallback', accessibleName: 'Artifact workspace' },
  reflection_next_move: { renderer: 'reflection', fallback: 'learn-activity-fallback', accessibleName: 'Reflection and next move' },
} as const satisfies Record<AdaptiveActivityPrimitiveType, {
  renderer: AdaptiveActivityRenderer
  fallback: ReturnType<typeof adaptiveActivityFallbackForReason>['testId']
  accessibleName: string
}>

type ProjectedPrimitive = {
  contractVersion?: unknown
  rendererVersion?: unknown
  type?: unknown
  action?: unknown
  testId?: unknown
  props?: unknown
}

function failure(reason: AdaptiveActivityValidationReason) {
  return { ok: false as const, reason, fallback: adaptiveActivityFallbackForReason(reason) }
}

export function resolveAdaptiveActivityRenderer(
  input: unknown,
  expectedRenderer: AdaptiveActivityRenderer,
  evidenceContext: AdaptiveActivityEvidenceContext = {},
): { ok: true, value: ValidatedAdaptiveActivityPrimitive, renderer: AdaptiveActivityRenderer, accessibleName: string } | ReturnType<typeof failure> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('invalid_props')
  const primitive = input as ProjectedPrimitive
  if (typeof primitive.type !== 'string' || !Object.hasOwn(ADAPTIVE_ACTIVITY_RENDERERS, primitive.type)) return failure('unknown_primitive')
  if (primitive.contractVersion !== ADAPTIVE_ACTIVITY_CONTRACT_VERSION
    || primitive.rendererVersion !== ADAPTIVE_ACTIVITY_RENDERER_VERSION) return failure('invalid_props')
  const validated = validateAdaptiveActivityPrimitive({ type: primitive.type, action: primitive.action, props: primitive.props }, evidenceContext)
  if (!validated.ok) return failure(validated.error.code)
  if (Object.keys(primitive).length !== 6
    || !['contractVersion', 'rendererVersion', 'type', 'action', 'testId', 'props'].every(key => Object.hasOwn(primitive, key))) return failure('invalid_props')
  if (primitive.testId !== validated.value.testId) return failure('invalid_props')
  const descriptor = ADAPTIVE_ACTIVITY_RENDERERS[validated.value.type]
  if (canvasRendererForPrimitive(validated.value.type) !== descriptor.renderer
    || descriptor.renderer !== expectedRenderer) return failure('renderer_unavailable')
  return { ok: true, value: validated.value, renderer: descriptor.renderer, accessibleName: descriptor.accessibleName }
}
