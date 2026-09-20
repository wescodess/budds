export type ActivationDecision = { enabled: boolean, code: string, detail: string }
export const ACTIVATION_DIAGNOSTICS: Readonly<Record<string, string>>
export const CALIBRATION_LABELS: readonly string[]
export function verifyQuizSemanticActivation(input: Record<string, unknown>): ActivationDecision
export function calculateCalibrationMetrics(rows: Array<Record<string, unknown>>): Record<string, unknown>
export function calculateCalibrationEvidence(rows: Array<Record<string, unknown>>): { metrics: Record<string, unknown>, statistics: Record<string, unknown> }
export function applyTemperature(probabilities: Record<string, number>, temperature: number): Record<string, number>
export function fitTemperature(rows: Array<Record<string, unknown>>): { temperature: number, nllBefore: number, nllAfter: number, iterations: number, bounds: number[] }
