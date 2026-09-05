function boundedOrder(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid ${label}`)
  return value
}

export function mainUtteranceVerificationId(
  sceneId: string,
  sceneOrder: number,
  utteranceOrder: number,
): string {
  const normalizedSceneId = sceneId.trim()
  if (!normalizedSceneId || normalizedSceneId.length > 80) throw new TypeError('Invalid Scene identity')
  return `scene:${boundedOrder(sceneOrder, 'Scene order')}:${normalizedSceneId}:utterance:${boundedOrder(utteranceOrder, 'Utterance order')}`
}

export function interjectionUtteranceVerificationId(interjectionId: string, utteranceOrder: number): string {
  const normalizedInterjectionId = interjectionId.trim()
  if (!normalizedInterjectionId || normalizedInterjectionId.length > 160) {
    throw new TypeError('Invalid Interjection identity')
  }
  return `interjection:${normalizedInterjectionId}:utterance:${boundedOrder(utteranceOrder, 'Utterance order')}`
}
