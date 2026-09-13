export type Complexity = 'beginner' | 'expert'
export type LengthMinutes = 5 | 10 | 20

export interface CustomizeSubmit {
  lengthMinutes: LengthMinutes
  complexity: Complexity
  hostNames: { hostA: string, hostB: string }
}
