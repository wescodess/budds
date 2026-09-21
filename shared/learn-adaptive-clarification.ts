export const INITIAL_DECISION_VERSION = 'learn-adaptive.initial-decision.v1' as const
export const CLARIFICATION_TEMPLATE_VERSION = 'learn-adaptive.clarification-templates.v1' as const
export const CLARIFICATION_MAX_ANSWER_BYTES = 1_000

export type InitialDecisionInput = {
  intent: 'understand' | 'prepare' | 'build' | 'master' | 'refresh' | 'explore'
  availableTime: '15' | '25' | '45' | '60' | 'no_limit'
  authorityKind: 'standalone' | 'v2_mission'
  sourceKind: 'none' | 'folder' | 'document' | 'url' | 'pasted'
  evidenceState: 'none' | 'preparing' | 'ready' | 'blocked' | 'stale' | 'invalidated' | 'unavailable'
  outcomeProvenance: 'explicit' | 'need_fallback' | 'clarification'
  threadRevision: number
}

export type InitialContinuationKind = 'ready_v2' | 'standalone_non_factual' | 'preparing_non_factual' | 'evidence_recovery'
export type InitialDecision = {
  decisionVersion: typeof INITIAL_DECISION_VERSION
  kind: 'direct' | 'clarification'
  questionKey?: 'useful_outcome'
  reasonCode: 'outcome_needed_for_first_move' | 'declared_inputs_sufficient' | 'evidence_requires_recovery'
  continuationKind: InitialContinuationKind
}

const RECOVERY_STATES = new Set<InitialDecisionInput['evidenceState']>(['blocked', 'stale', 'invalidated', 'unavailable'])

function continuationFor(input: InitialDecisionInput): InitialContinuationKind {
  if (RECOVERY_STATES.has(input.evidenceState)) return 'evidence_recovery'
  if (input.authorityKind === 'v2_mission' && input.evidenceState === 'ready') return 'ready_v2'
  if (input.evidenceState === 'preparing') return 'preparing_non_factual'
  return 'standalone_non_factual'
}

export function selectInitialDecision(input: InitialDecisionInput): InitialDecision {
  const continuationKind = continuationFor(input)
  if (continuationKind === 'evidence_recovery') return { decisionVersion: INITIAL_DECISION_VERSION, kind: 'direct', reasonCode: 'evidence_requires_recovery', continuationKind }
  // Phase 1 deliberately uses only declared structure. Prepare/build without
  // a distinct learner outcome is the single conservative ambiguity proxy;
  // later router stories may add versioned signals without changing v1 replay.
  if ((input.intent === 'prepare' || input.intent === 'build') && input.outcomeProvenance === 'need_fallback') {
    return { decisionVersion: INITIAL_DECISION_VERSION, kind: 'clarification', questionKey: 'useful_outcome', reasonCode: 'outcome_needed_for_first_move', continuationKind }
  }
  return { decisionVersion: INITIAL_DECISION_VERSION, kind: 'direct', reasonCode: 'declared_inputs_sufficient', continuationKind }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

export async function digestInitialDecisionInput(input: InitialDecisionInput) {
  const bytes = new TextEncoder().encode(canonicalJson([INITIAL_DECISION_VERSION, input]))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export function renderClarification(questionKey: 'useful_outcome', templateVersion: string = CLARIFICATION_TEMPLATE_VERSION) {
  if (templateVersion !== CLARIFICATION_TEMPLATE_VERSION) throw new Error('Unsupported clarification template version')
  if (questionKey !== 'useful_outcome') throw new Error('Unsupported clarification question')
  return {
    templateVersion: CLARIFICATION_TEMPLATE_VERSION,
    prompt: 'What outcome would make this first step useful?',
    help: 'Name one concrete result. You can also skip and continue from your original wording.',
  }
}

export function validateClarificationAnswer(value: string) {
  const answer = value.trim()
  const bytes = new TextEncoder().encode(answer).byteLength
  if (!answer || bytes > CLARIFICATION_MAX_ANSWER_BYTES) throw new Error('Clarification answer must be between 1 and 1000 bytes')
  return answer
}
