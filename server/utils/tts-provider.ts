import { synthesizeVoice, synthesizeVoiceWithRetry, type AuraVoice } from './tts-workers-ai'
import {
  isDiaConfigured,
  isDiaServerHealthy,
  ensureDiaServerRunning,
  synthesizeDiaVoice,
  synthesizeDiaVoiceWithRetry,
  synthesizeDiaDialogueWithRetry,
  synthesizeDiaDialogue,
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
  requestId?: string,
): Promise<{ audio: Uint8Array; durationMs: number; requestId: string; wordTimings: { word: string, start: number, end: number }[] }> {
  const result = await synthesizeDiaDialogueWithRetry({ script, requestId })
  return { audio: result.audio, durationMs: Math.round(result.durationSec * 1000), requestId: result.requestId, wordTimings: result.wordTimings }
}

export async function synthesizeTurnOnce(
  text: string,
  role: 'host_a' | 'host_b',
  engine: TtsEngine,
  auraVoice?: AuraVoice,
): Promise<Uint8Array> {
  if (engine === 'dia') return synthesizeDiaVoice({ text, speaker: roleToDiaSpeaker(role) })
  if (!auraVoice) throw createError({ statusCode: 500, message: 'Aura voice not specified for aura-1 engine' })
  return synthesizeVoice({ text, speaker: auraVoice, maxAttempts: 1 })
}

export async function synthesizeDialogueOnce(
  script: string,
  requestId: string,
): Promise<{ audio: Uint8Array; durationMs: number; requestId: string; wordTimings: { word: string, start: number, end: number }[] }> {
  const result = await synthesizeDiaDialogue({ script, requestId })
  return { audio: result.audio, durationMs: Math.round(result.durationSec * 1000), requestId: result.requestId, wordTimings: result.wordTimings }
}


export function engineVoiceProfile(engine: TtsEngine): { hostA: string; hostB: string } {
  if (engine === 'dia') return { hostA: 'dia-S1', hostB: 'dia-S2' }
  return { hostA: 'asteria', hostB: 'orion' }
}
