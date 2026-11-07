import type { Doc, Id, TableNames } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type ReadCtx = QueryCtx | MutationCtx
export type ArtifactLineageInvocation<C extends ReadCtx = ReadCtx> = {
  ctx: QueryCtx
  memo<T>(key: string, operation: () => Promise<T>): Promise<T>
  get<T extends TableNames>(id: Id<T>): Promise<Doc<T> | null>
  read<T>(operation: () => Promise<T>): Promise<T>
  write<T>(operation: (db: C['db']) => Promise<T>): Promise<T>
}

export function copyArtifactLineageValue<T>(value: T): T {
  if (value instanceof ArrayBuffer) return value.slice(0) as T
  if (Array.isArray(value)) return value.map(copyArtifactLineageValue) as T
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyArtifactLineageValue(child)])) as T
  return value
}

export async function withArtifactLineageInvocation<C extends ReadCtx, R>(ctx: C, operation: (scope: ArtifactLineageInvocation<C>) => Promise<R>): Promise<R> {
  const memory = new Map<string, unknown>()
  let generation = 0
  let active = true
  const requireActive = () => { if (!active) throw new Error('Artifact lineage invocation closed') }
  const clear = () => { memory.clear(); generation++ }
  const memo = async <T>(key: string, read: () => Promise<T>): Promise<T> => {
    requireActive()
    if (memory.has(key)) return copyArtifactLineageValue(memory.get(key)) as T
    const version = generation
    const value = await read()
    if (active && generation === version) memory.set(key, copyArtifactLineageValue(value))
    return copyArtifactLineageValue(value)
  }
  const scope: ArtifactLineageInvocation<C> = {
    ctx,
    memo,
    get: id => memo(`row:${id}`, () => ctx.db.get(id)),
    async read(read) { requireActive(); return copyArtifactLineageValue(await read()) },
    async write(write) {
      requireActive()
      clear()
      try { return await write(ctx.db) }
      finally { clear() }
    },
  }
  try { return await operation(scope) }
  finally { clear(); active = false }
}
