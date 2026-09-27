import type { AdaptiveEvidenceState } from './learn-adaptive-activity-plan'

export function adaptiveRecoveryCopy(state: AdaptiveEvidenceState) {
  switch (state) {
    case 'preparing': return { title: 'Your material is preparing', body: 'You can record what you already know while the selected material prepares.', action: 'Back to Learn' }
    case 'blocked': return { title: 'Evidence is blocked', body: 'The selected material cannot support factual study yet. Any response you saved remains available.', action: 'Back to Learn' }
    case 'stale': return { title: 'Evidence needs refreshing', body: 'The selected material changed. Review it before factual study continues. Any response you saved remains available.', action: 'Back to Learn' }
    case 'invalidated': return { title: 'Evidence was invalidated', body: 'The earlier support is no longer usable. Any response you saved remains available.', action: 'Back to Learn' }
    case 'unavailable': return { title: 'Evidence is unavailable', body: 'The selected material cannot be accessed. Choose an available source to continue factual study. Any response you saved remains available.', action: 'Back to Learn' }
    case 'ready': return { title: 'Source status changed', body: 'Keep this diagnostic. Open Learn to choose a supported session once accepted evidence and published content are available.', action: 'Back to Learn' }
    case 'none': return { title: 'Start from your goal', body: 'Record what you already know. You can add a source before factual study.', action: 'Back to Learn' }
  }
}
