/**
 * UI-facing Learn V2 snapshots. Adapters translate Convex documents to these
 * stable shapes; components only render snapshots and emit learner intent.
 */
export type LearnMissionLifecycle = 'draft' | 'source_review' | 'map_review' | 'calibration' | 'plan_review' | 'active' | 'blocked' | 'superseded'
export type LearnWorkspaceSection = 'overview' | 'sources' | 'map' | 'plan' | 'progress'
export type LearnMasteryState = 'unseen' | 'learning' | 'guided' | 'independent' | 'retained' | 'needs_review' | 'blocked' | 'provisionally_known'
export type LearnSourceOrigin = 'folder_document' | 'user_url' | 'open_database' | 'general_web_search'
export type LearnSourceLifecycle = 'candidate' | 'fetched' | 'evaluated' | 'user_accepted' | 'rejected' | 'unavailable'
export type LearnCoverage = 'strong' | 'partial' | 'gap'

export interface LearnNextAction { kind: 'finish_setup' | 'review_sources' | 'review_map' | 'calibrate' | 'review_plan' | 'start_session' | 'resume_session' | 'review_now' | 'resolve_block'; label: string; detail: string }
export interface LearnMasterySummary { retained: number; independent: number; learning: number; total: number; needsReview?: number }
export interface LearnMissionSnapshot { id: string; title: string; folderName: string; lifecycle: LearnMissionLifecycle; nextAction: LearnNextAction; mastery: LearnMasterySummary; targetLabel?: string; upcomingLabel?: string }
export interface LearnHubSnapshot { today?: LearnMissionSnapshot | null; missions: LearnMissionSnapshot[]; upcoming?: Array<{ id: string; title: string; when: string; kind: 'learning' | 'review' | 'retained_check' }> }
export interface LearnReadinessItem { id: string; label: string; state: 'complete' | 'current' | 'attention' | 'locked'; detail?: string }
export interface LearnOutcomeDraft { folderName?: string; folderDocumentCount: number; outcome: string; mode: 'understand' | 'prepare' | 'apply'; depth: 'overview' | 'working' | 'deep'; targetDate?: string; sessionMinutes: 15 | 20 | 25 | 30 | 45 | 60; sourcePolicy: 'folder_only' | 'folder_plus_web' | 'web_only'; accessibility?: { reduceMotion?: boolean; highContrast?: boolean; hideTimeGuidance?: boolean } }
export interface LearnSourceSnapshot { id: string; sourceKey: string; title: string; origin: LearnSourceOrigin; publisher?: string; retrievedLabel: string; coverage: LearnCoverage; lifecycle: LearnSourceLifecycle; objectives: string[]; accessNote?: string; excerpt?: string; originalUrl?: string }
export interface LearnAssessmentCriterion { key: string; description: string; weightPercent: number }
export interface LearnAssessmentContract { version: 'learn-v2.assessment.v1'; kind: 'machine_checkable' | 'bounded_rubric'; responseFormat: 'short_text' | 'structured'; instructions: string; passingScorePercent: 80; criteria: LearnAssessmentCriterion[] }
export interface LearnObjectiveSourceLink { sourceKey: string; title: string; origin: LearnSourceOrigin; coverage: LearnCoverage; evidenceStatus: 'evidence_available' | 'evidence_unavailable' }
export interface LearnObjectiveSnapshot { id: string; stableKey: string; title: string; capability: string; milestoneKey: string; milestone: string; effortMinutes: number; depth: 'foundational' | 'working' | 'advanced'; mastery: LearnMasteryState; coverage: LearnCoverage; gapReason?: string; prerequisiteIds: string[]; prerequisiteKeys: string[]; assessment: string; assessmentContract: LearnAssessmentContract; sourceLinks: LearnObjectiveSourceLink[]; detail?: string }
export interface LearnPlanSessionSnapshot { id: string; title: string; when: string; durationMinutes: number; kind: 'learning' | 'review' | 'buffer' | 'rest' | 'retained_check'; objectiveId?: string }
export interface LearnPlanSnapshot { feasibility: 'feasible' | 'constrained' | 'pending'; headline: string; detail: string; weeklyLoadLabel: string; targetLabel: string; sessions: LearnPlanSessionSnapshot[]; alternatives?: string[]; calendarStatus?: 'not_connected' | 'ready' | 'attention' }

export interface LearnScheduleInput { version: 'learn-v2.schedule-input.v1'; timezone: string; startLocalDate: string; targetLocalDate: string | null; sessionMinutes: 15 | 20 | 25 | 30 | 45 | 60; availability: Array<{ weekday: number; start: string; end: string }>; blackoutDates: string[]; reviewIntervalsDays: number[]; minRestMinutes: number }
export interface LearnObjectiveDraft { objectiveKey?: string; title: string; capability: string; milestoneKey: string; effortMinutes: number; depth: 'foundational' | 'working' | 'advanced'; coverage: LearnCoverage; gapReason?: string; supportingSourceKeys: string[]; gapSourceKeys: string[]; prerequisiteKeys: string[]; assessmentContract: LearnAssessmentContract }
export type LearnMapEdit =
  | { kind: 'save_objective'; objective: LearnObjectiveDraft }
  | { kind: 'move_objective'; objectiveKey: string; direction: 'up' | 'down' }
  | { kind: 'remove_objective'; objectiveKey: string }
  | { kind: 'split_objective'; objectiveKey: string; firstTitle: string; secondTitle: string }

export type LearnOutcomeIntent = LearnOutcomeDraft
export type LearnSourceIntent = { query?: string; url?: string }
