import { synthesizeVoiceWithRetry, type AuraVoice } from './tts-workers-ai'
import {
  isDiaConfigured,
  isDiaServerHealthy,
  ensureDiaServerRunning,
  synthesizeDiaVoiceWithRetry,
  synthesizeDiaDialogueWithRetry,
  type DiaSpeaker,
} from './tts-dia'

export type TtsEngine = 'dia' | 'aura-1'

export async function resolveTtsEngine(): Promise<TtsEngine> {
  if (!isDiaConfigured()) return 'aura-1'

  if (await isDiaServerHealthy()) return 'dia'

  const started = await ensureDiaServerRunning()
  return started ? 'dia' : 'aura-1'
}

function roleToDiaSpeaker(role: 'host_a' | 'host_b'): DiaSpeaker {
  return role === 'host_a' ? 'S1' : 'S2'
}

export async function synthesizeTurn(
  text: string,
  role: 'host_a' | 'host_b',
  engine: TtsEngine,
  auraVoice?: AuraVoice,
): Promise<Uint8Array> {
  if (engine === 'dia') {
    return synthesizeDiaVoiceWithRetry({ text, speaker: roleToDiaSpeaker(role) })
  }

  if (!auraVoice) {
    throw createError({ statusCode: 500, message: 'Aura voice not specified for aura-1 engine' })
  }
  return synthesizeVoiceWithRetry({ text, speaker: auraVoice })
}

export async function synthesizeDialogue(
  script: string,
): Promise<{ audio: Uint8Array; durationMs: number }> {
  const result = await synthesizeDiaDialogueWithRetry({ script })
  return { audio: result.audio, durationMs: Math.round(result.durationSec * 1000) }
}

export function engineVoiceProfile(engine: TtsEngine): { hostA: string; hostB: string } {
  if (engine === 'dia') return { hostA: 'dia-S1', hostB: 'dia-S2' }
  return { hostA: 'asteria', hostB: 'orion' }
}
