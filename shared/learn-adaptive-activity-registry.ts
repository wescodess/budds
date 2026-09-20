export const ADAPTIVE_ACTIVITY_CONTRACT_VERSION = 'learn-adaptive.activity-contract.v1' as const
export const ADAPTIVE_ACTIVITY_RENDERER_VERSION = 'learn-adaptive.renderer.v1' as const
export const ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION = 'learn-adaptive.primitive-validation.v1' as const
export const ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION = 'learn-adaptive.primitive-sequence-validation.v1' as const
export const ADAPTIVE_ACTIVITY_FALLBACK_ANALYTICS_VERSION = 'learn-adaptive.primitive-fallback.v1' as const
export const ADAPTIVE_ACTIVITY_FALLBACK_VERSION = 'learn-adaptive.text-card-fallback.v1' as const

const FALLBACK_TEST_ID = 'learn-activity-fallback' as const

const registry = [
  { type: 'cited_explanation', allowedActions: ['continue', 'inspect_source', 'ask_for_example'], testId: 'learn-primitive-cited-explanation' },
  { type: 'diagnostic_prompt', allowedActions: ['submit_response'], testId: 'learn-primitive-diagnostic-prompt' },
  { type: 'worked_example', allowedActions: ['reveal_example', 'continue'], testId: 'learn-primitive-worked-example' },
  { type: 'independent_application', allowedActions: ['submit_response', 'save_draft'], testId: 'learn-primitive-independent-application' },
  { type: 'source_comparison', allowedActions: ['choose_source', 'submit_comparison'], testId: 'learn-primitive-source-comparison' },
  { type: 'artifact_workspace', allowedActions: ['save_artifact', 'apply_artifact', 'share_artifact'], testId: 'learn-primitive-artifact-workspace' },
  { type: 'reflection_next_move', allowedActions: ['accept_next_move', 'override_next_move', 'end_thread'], testId: 'learn-primitive-reflection-next-move' },
] as const

export type AdaptiveActivityPrimitiveType = typeof registry[number]['type']
export type AdaptiveEvidenceIntegrityState = 'accepted' | 'conflict' | 'gap' | 'stale' | 'unavailable'
export type AdaptiveActivityEvidenceContext = Readonly<Record<string, Readonly<{ integrityState: AdaptiveEvidenceIntegrityState }>>>
type AdaptiveActivityAction<Type extends AdaptiveActivityPrimitiveType> = Extract<typeof registry[number], { type: Type }>['allowedActions'][number]

interface AdaptiveActivityProps {
  cited_explanation: { heading: string, explanation: string, sourceRefs: string[] }
  diagnostic_prompt: { prompt: string, responseFormat: 'short_text' | 'long_text', assistance: 'none' | 'hint_available' }
  worked_example: { heading: string, problem: string, steps: string[], guidedConsequence: string, sourceRefs: string[] }
  independent_application: { prompt: string, responseFormat: 'short_text' | 'long_text' | 'structured', draftPersistence: boolean }
  source_comparison: { prompt: string, sources: Array<{ sourceRef: string, label: string, summary: string, integrityState: AdaptiveEvidenceIntegrityState }> }
  artifact_workspace: { prompt: string, artifactKind: 'note' | 'plan' | 'draft' | 'answer' | 'other', starterText: string }
  reflection_next_move: { feedback: string, nextMove: string, allowedDecisions: Array<'accept' | 'override' | 'end'> }
}

type PrimitiveValue<Type extends AdaptiveActivityPrimitiveType> = {
  contractVersion: typeof ADAPTIVE_ACTIVITY_CONTRACT_VERSION
  rendererVersion: typeof ADAPTIVE_ACTIVITY_RENDERER_VERSION
  type: Type
  action: AdaptiveActivityAction<Type>
  props: AdaptiveActivityProps[Type]
  testId: Extract<typeof registry[number], { type: Type }>['testId']
}

export type ValidatedAdaptiveActivityPrimitive = {
  [Type in AdaptiveActivityPrimitiveType]: PrimitiveValue<Type>
}[AdaptiveActivityPrimitiveType]

type UnknownRecord = Record<string, unknown>
export type AdaptiveActivityValidationReason = 'unknown_primitive' | 'unsupported_action' | 'oversized_prop' | 'oversized_plan' | 'unsafe_url' | 'executable_content' | 'invalid_props' | 'invalid_evidence_link'

class AdaptiveActivityValidationError extends Error {
  constructor(public readonly code: AdaptiveActivityValidationReason, message: string) { super(message) }
}

function invalid(code: AdaptiveActivityValidationReason, message: string): never {
  throw new AdaptiveActivityValidationError(code, message)
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('invalid_props', `${label} must be an object`)
  return value as UnknownRecord
}

function exact(value: UnknownRecord, required: readonly string[], label: string) {
  if (Object.keys(value).length !== required.length || required.some(key => !(key in value))) invalid('invalid_props', `${label} has invalid props`)
}

function text(value: unknown, label: string, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || /[\p{Cc}\p{Cf}]/u.test(value)) invalid('invalid_props', `${label} is invalid`)
  const normalized = value.trim()
  if (normalized.length > maximum) invalid('oversized_prop', `${label} exceeds ${maximum} characters`)
  if (/\b(?:javascript|vbscript|file)\s*:|\bdata\s*:\s*text\/html/iu.test(normalized)) invalid('unsafe_url', `${label} contains an unsafe URL`)
  if (/<\/?[a-z][^>]*>|\bon[a-z]+\s*=/iu.test(normalized)) invalid('executable_content', `${label} contains executable markup`)
  return normalized
}

function references(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length < 1) invalid('invalid_props', `${label} are invalid`)
  if (value.length > 8) invalid('oversized_prop', `${label} exceed the maximum of 8`)
  const refs = value.map((item, index) => text(item, `${label} ${index}`, 200))
  if (new Set(refs).size !== refs.length) invalid('invalid_props', `${label} are invalid`)
  return refs
}

function choice<const T extends readonly string[]>(value: unknown, choices: T, label: string): T[number] {
  if (typeof value !== 'string' || !choices.includes(value)) invalid('invalid_props', `${label} is invalid`)
  return value as T[number]
}

function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') invalid('invalid_props', `${label} is invalid`)
  return value
}

function textArray(value: unknown, label: string, minimum: number, maximum: number, itemMaximum: number) {
  if (!Array.isArray(value) || value.length < minimum) invalid('invalid_props', `${label} are invalid`)
  if (value.length > maximum) invalid('oversized_prop', `${label} exceed the maximum of ${maximum}`)
  return value.map((item, index) => text(item, `${label} ${index}`, itemMaximum))
}

function evidenceReference(sourceRef: string, context: AdaptiveActivityEvidenceContext, acceptedOnly: boolean) {
  const contextRecord = context as Readonly<Record<string, unknown>>
  const candidate = Object.hasOwn(contextRecord, sourceRef) ? contextRecord[sourceRef] : null
  const integrityState = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? (candidate as UnknownRecord).integrityState
    : null
  const integrityStates: readonly AdaptiveEvidenceIntegrityState[] = ['accepted', 'conflict', 'gap', 'stale', 'unavailable']
  if (typeof integrityState !== 'string' || !integrityStates.includes(integrityState as AdaptiveEvidenceIntegrityState) || (acceptedOnly && integrityState !== 'accepted')) {
    invalid('invalid_evidence_link', `Evidence reference ${sourceRef} is not valid for this activity`)
  }
  return { integrityState: integrityState as AdaptiveEvidenceIntegrityState }
}

function validateProps<Type extends AdaptiveActivityPrimitiveType>(type: Type, value: unknown, context: AdaptiveActivityEvidenceContext): AdaptiveActivityProps[Type] {
  const props = record(value, `${type} props`)
  let validated: AdaptiveActivityProps[AdaptiveActivityPrimitiveType]
  switch (type) {
    case 'cited_explanation': {
      exact(props, ['heading', 'explanation', 'sourceRefs'], type)
      const sourceRefs = references(props.sourceRefs, 'Cited explanation source references')
      sourceRefs.forEach(sourceRef => evidenceReference(sourceRef, context, true))
      validated = { heading: text(props.heading, 'Cited explanation heading', 160), explanation: text(props.explanation, 'Cited explanation text', 4_000), sourceRefs }
      break
    }
    case 'diagnostic_prompt':
      exact(props, ['prompt', 'responseFormat', 'assistance'], type)
      validated = { prompt: text(props.prompt, 'Diagnostic prompt', 1_000), responseFormat: choice(props.responseFormat, ['short_text', 'long_text'], 'Diagnostic response format'), assistance: choice(props.assistance, ['none', 'hint_available'], 'Diagnostic assistance') }
      break
    case 'worked_example': {
      exact(props, ['heading', 'problem', 'steps', 'guidedConsequence', 'sourceRefs'], type)
      const sourceRefs = references(props.sourceRefs, 'Worked example source references')
      sourceRefs.forEach(sourceRef => evidenceReference(sourceRef, context, true))
      validated = { heading: text(props.heading, 'Worked example heading', 160), problem: text(props.problem, 'Worked example problem', 1_000), steps: textArray(props.steps, 'Worked example steps', 1, 8, 1_000), guidedConsequence: text(props.guidedConsequence, 'Worked example consequence', 300), sourceRefs }
      break
    }
    case 'independent_application':
      exact(props, ['prompt', 'responseFormat', 'draftPersistence'], type)
      validated = { prompt: text(props.prompt, 'Independent application prompt', 1_000), responseFormat: choice(props.responseFormat, ['short_text', 'long_text', 'structured'], 'Independent application response format'), draftPersistence: boolean(props.draftPersistence, 'Independent application draft persistence') }
      break
    case 'source_comparison': {
      exact(props, ['prompt', 'sources'], type)
      if (!Array.isArray(props.sources) || props.sources.length !== 2) invalid('invalid_props', 'Source comparison requires exactly two sources')
      const sources = props.sources.map((raw, index) => {
        const source = record(raw, `Source comparison source ${index}`)
        exact(source, ['sourceRef', 'label', 'summary'], `Source comparison source ${index}`)
        const sourceRef = text(source.sourceRef, `Source comparison source ${index} reference`, 200)
        return { sourceRef, label: text(source.label, `Source comparison source ${index} label`, 120), summary: text(source.summary, `Source comparison source ${index} summary`, 1_000), integrityState: evidenceReference(sourceRef, context, false).integrityState }
      })
      if (new Set(sources.map(source => source.sourceRef)).size !== sources.length) invalid('invalid_props', 'Source comparison sources must be unique')
      validated = { prompt: text(props.prompt, 'Source comparison prompt', 1_000), sources }
      break
    }
    case 'artifact_workspace':
      exact(props, ['prompt', 'artifactKind', 'starterText'], type)
      validated = { prompt: text(props.prompt, 'Artifact workspace prompt', 1_000), artifactKind: choice(props.artifactKind, ['note', 'plan', 'draft', 'answer', 'other'], 'Artifact kind'), starterText: text(props.starterText, 'Artifact starter text', 4_000) }
      break
    case 'reflection_next_move': {
      exact(props, ['feedback', 'nextMove', 'allowedDecisions'], type)
      const allowedDecisions = textArray(props.allowedDecisions, 'Reflection decisions', 1, 3, 16).map(value => choice(value, ['accept', 'override', 'end'], 'Reflection decision'))
      if (new Set(allowedDecisions).size !== allowedDecisions.length) invalid('invalid_props', 'Reflection decisions must be unique')
      validated = { feedback: text(props.feedback, 'Reflection feedback', 2_000), nextMove: text(props.nextMove, 'Reflection next move', 500), allowedDecisions }
      break
    }
  }
  return validated as AdaptiveActivityProps[Type]
}

function fallback(code: AdaptiveActivityValidationReason) {
  const bodies: Record<AdaptiveActivityValidationReason, string> = {
    unknown_primitive: 'This activity type is not supported.',
    unsupported_action: 'This activity action is not supported.',
    oversized_prop: 'This activity contains too much content.',
    oversized_plan: 'This activity contains too many parts.',
    unsafe_url: 'This activity contains an unsafe link.',
    executable_content: 'This activity contains unsupported executable content.',
    invalid_props: 'This activity could not be displayed safely.',
    invalid_evidence_link: 'This activity references evidence that is unavailable.',
  }
  return { version: ADAPTIVE_ACTIVITY_FALLBACK_VERSION, kind: 'text_card' as const, title: 'Activity unavailable', body: bodies[code], primaryAction: { type: 'continue_safe' as const, label: 'Continue safely' }, testId: FALLBACK_TEST_ID }
}

export function getAdaptiveActivityRegistry() {
  return {
    contractVersion: ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
    rendererVersion: ADAPTIVE_ACTIVITY_RENDERER_VERSION,
    analytics: {
      validation: { name: 'adaptive_primitive_validation' as const, version: ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION, outcomes: ['valid', 'rejected'] as const },
      sequenceValidation: { name: 'adaptive_primitive_sequence_validation' as const, version: ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION, outcomes: ['valid', 'rejected'] as const },
      fallback: { name: 'adaptive_primitive_fallback' as const, version: ADAPTIVE_ACTIVITY_FALLBACK_ANALYTICS_VERSION, outcomes: ['fallback'] as const },
    },
    registeredTypes: registry.map(entry => entry.type),
    primitives: registry.map(entry => ({ ...entry, allowedActions: [...entry.allowedActions] })),
    fallback: { version: ADAPTIVE_ACTIVITY_FALLBACK_VERSION, testId: FALLBACK_TEST_ID },
  }
}

export function validateAdaptiveActivityPrimitive(input: unknown, evidenceContext: AdaptiveActivityEvidenceContext = {}) {
  const rawType = input && typeof input === 'object' && !Array.isArray(input) && typeof (input as UnknownRecord).type === 'string' ? (input as UnknownRecord).type as string : null
  const knownEntry = registry.find(item => item.type === rawType)
  try {
    const candidate = record(input, 'Adaptive primitive')
    exact(candidate, ['type', 'action', 'props'], 'Adaptive primitive')
    const entry = registry.find(item => item.type === candidate.type)
    if (!entry) invalid('unknown_primitive', 'Adaptive primitive is not registered')
    if (typeof candidate.action !== 'string' || !(entry.allowedActions as readonly string[]).includes(candidate.action)) invalid('unsupported_action', 'Adaptive primitive action is unsupported')
    const value = {
      contractVersion: ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
      rendererVersion: ADAPTIVE_ACTIVITY_RENDERER_VERSION,
      type: entry.type,
      action: candidate.action,
      props: validateProps(entry.type, candidate.props, evidenceContext),
      testId: entry.testId,
    } as ValidatedAdaptiveActivityPrimitive
    return { ok: true as const, value, analytics: { name: 'adaptive_primitive_validation' as const, version: ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION, outcome: 'valid' as const, primitiveType: value.type, reasonCode: null } }
  }
  catch (error) {
    if (!(error instanceof AdaptiveActivityValidationError)) throw error
    return {
      ok: false as const,
      error: { code: error.code, message: error.message },
      fallback: fallback(error.code),
      analytics: { name: 'adaptive_primitive_validation' as const, version: ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION, outcome: 'rejected' as const, primitiveType: knownEntry?.type ?? null, reasonCode: error.code },
      fallbackAnalytics: { name: 'adaptive_primitive_fallback' as const, version: ADAPTIVE_ACTIVITY_FALLBACK_ANALYTICS_VERSION, outcome: 'fallback' as const, primitiveType: knownEntry?.type ?? null, reasonCode: error.code },
    }
  }
}

export function validateAdaptiveActivityPrimitiveSequence(input: unknown, evidenceContext: AdaptiveActivityEvidenceContext = {}) {
  const primitiveCount = Array.isArray(input) ? input.length : 0
  const sequenceFailure = (code: AdaptiveActivityValidationReason, message: string, primitiveIndex: number | null = null) => ({
    ok: false as const,
    error: { code, message, primitiveIndex },
    fallback: fallback(code),
    analytics: { name: 'adaptive_primitive_sequence_validation' as const, version: ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION, outcome: 'rejected' as const, primitiveCount, primitiveIndex, reasonCode: code },
    fallbackAnalytics: { name: 'adaptive_primitive_fallback' as const, version: ADAPTIVE_ACTIVITY_FALLBACK_ANALYTICS_VERSION, outcome: 'fallback' as const, primitiveCount, primitiveIndex, reasonCode: code },
  })
  if (!Array.isArray(input) || input.length < 1) return sequenceFailure('invalid_props', 'Adaptive primitive sequence must contain at least one item')
  if (input.length > 7) return sequenceFailure('oversized_plan', 'Adaptive primitive sequence exceeds seven items')
  const primitives: ValidatedAdaptiveActivityPrimitive[] = []
  for (const [primitiveIndex, candidate] of input.entries()) {
    const result = validateAdaptiveActivityPrimitive(candidate, evidenceContext)
    if (!result.ok) return sequenceFailure(result.error.code, result.error.message, primitiveIndex)
    primitives.push(result.value)
  }
  return {
    ok: true as const,
    value: { contractVersion: ADAPTIVE_ACTIVITY_CONTRACT_VERSION, rendererVersion: ADAPTIVE_ACTIVITY_RENDERER_VERSION, primitives },
    analytics: { name: 'adaptive_primitive_sequence_validation' as const, version: ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION, outcome: 'valid' as const, primitiveCount: primitives.length, primitiveIndex: null, reasonCode: null },
  }
}
