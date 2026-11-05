import type { Page } from '@playwright/test'

type ConvexFrame = { type?: string, udfPath?: string, args?: unknown[], modifications?: Array<{ type?: string, udfPath?: string, args?: unknown[] }> }
export type ConvexCall = { kind: 'mutation' | 'query', name: string, args: string }

export function recordConvexCalls(page: Page) {
  const calls: ConvexCall[] = []
  const functionName = (udfPath: string) => udfPath.replace(/\.js:/, ':')
  page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
    if (typeof payload !== 'string') return
    let frame: ConvexFrame
    try { frame = JSON.parse(payload) as ConvexFrame }
    catch { return }
    if (frame.type === 'Mutation' && frame.udfPath) calls.push({ kind: 'mutation', name: functionName(frame.udfPath), args: JSON.stringify(frame.args ?? []) })
    if (frame.type !== 'ModifyQuerySet') return
    for (const change of frame.modifications ?? []) {
      if (change.type === 'Add' && change.udfPath) calls.push({ kind: 'query', name: functionName(change.udfPath), args: JSON.stringify(change.args ?? []) })
    }
  }))
  return calls
}
