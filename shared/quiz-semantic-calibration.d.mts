export type ActivationDecision = { enabled: boolean, code: string, detail: string }
export const ACTIVATION_DIAGNOSTICS: Readonly<Record<string, string>>
export const CALIBRATION_LABELS: readonly string[]
export function verifyQuizSemanticActivation(input: Record<string, unknown>): ActivationDecision
export function calculateCalibrationEvidence(rows: unknown[]): { metrics: Record<string, unknown>, statistics: Record<string, unknown> }
export function calculateCalibrationMetrics(rows: unknown[]): Record<string, unknown>
export function applyTemperature(probabilities: Record<string, number>, temperature: number): Record<string, number>
export function fitTemperature(rows: unknown[]): { temperature: number, nllBefore: number, nllAfter: number, iterations: number, bounds: number[] }
