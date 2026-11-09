/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import type { MutationCtx } from './_generated/server'
import { withArtifactLineageInvocation, type ArtifactLineageInvocation } from './lib/learnV2ArtifactLineageInvocation'

const modules = import.meta.glob('./**/*.ts')
const userId = 'https://auth.example.com|invocation-owner'
async function document(ctx: MutationCtx) {
  const folderId = await ctx.db.insert('folders', { userId, name: 'Owned', documentCount: 1 })
  return ctx.db.insert('documents', { userId, folderId, filename: 'notes.txt', status: 'success', fileSize: 1 })
}

describe('round-4 invocation lifetime and private copies', () => {
  test('each call rereads rows and facts without changing its context or writer', async () => {
    const t = convexTest(schema, modules)
    await t.run(async ctx => {
      const id = await document(ctx)
      const patch = ctx.db.patch
      const keys = Reflect.ownKeys(ctx.db)
      const read = () => withArtifactLineageInvocation(ctx, async scope => {
        const row = await scope.get(id)
        return scope.memo('status', async () => row?.status)
      })
      expect(await read()).toBe('success')
      await patch(id, { status: 'indexing' })
      expect(await read()).toBe('indexing')
      expect(Reflect.ownKeys(ctx.db)).toEqual(keys)
      expect(ctx.db.patch).toBe(patch)
    })
  })

  test.each(['returned', 'thrown'] as const)('a %s call disposes its invocation', async outcome => {
    const t = convexTest(schema, modules)
    await t.run(async ctx => {
      const id = await document(ctx)
      const scopes: ArtifactLineageInvocation<MutationCtx>[] = []
      const result = withArtifactLineageInvocation(ctx, async scope => {
        scopes.push(scope)
        await scope.get(id)
        if (outcome === 'thrown') throw new Error('Invocation failed')
      })
      if (outcome === 'thrown') await expect(result).rejects.toThrow('Invocation failed')
      else await result
      await expect(scopes[0]!.get(id)).rejects.toThrow('invocation closed')
    })
  })

  test('row and fact storage never aliases input or returned objects', async () => {
    const t = convexTest(schema, modules)
    await t.run(async ctx => {
      const id = await document(ctx)
      const row = (await ctx.db.get(id))!
      const db = new Proxy(ctx.db, { get(target, property) {
        if (property === 'get') return async () => row
        const method: unknown = Reflect.get(target, property)
        return typeof method === 'function' ? method.bind(target) : method
      } })
      await withArtifactLineageInvocation({ ...ctx, db }, async scope => {
        const first = (await scope.get(id))!
        expect(first).not.toBe(row)
        first.status = 'failed'
        row.status = 'indexing'
        const second = (await scope.get(id))!
        expect(second.status).toBe('success')
        second.status = 'processing'
        expect((await scope.get(id))!.status).toBe('success')
        const input = { nested: [{ value: 'original' }], bytes: new Uint8Array([1]).buffer }
        const value = await scope.memo('fact', async () => input)
        input.nested[0]!.value = 'source edit'
        value.nested[0]!.value = 'returned edit'
        new Uint8Array(value.bytes)[0] = 2
        const cached = await scope.memo('fact', async () => input)
        expect(Array.isArray(cached.nested)).toBe(true)
        expect(cached.nested[0]!.value).toBe('original')
        expect(new Uint8Array(cached.bytes)[0]).toBe(1)
        cached.nested[0]!.value = 'second edit'
        expect((await scope.memo('fact', async () => input)).nested[0]!.value).toBe('original')
      })
    })
  })

  test('query rows are copied before use', async () => {
    const t = convexTest(schema, modules)
    await t.run(async ctx => {
      const id = await document(ctx)
      const row = (await ctx.db.get(id))!
      await withArtifactLineageInvocation(ctx, async scope => {
        const rows = await scope.read(async () => [row])
        rows[0]!.status = 'failed'
        expect(row.status).toBe('success')
      })
    })
  })

  test('a read started before an own write cannot repopulate its cleared cache', async () => {
    const t = convexTest(schema, modules)
    await t.run(async ctx => {
      const id = await document(ctx)
      await withArtifactLineageInvocation(ctx, async scope => {
        let complete: (value: string) => void = () => {}
        const pending = new Promise<string>(resolve => { complete = resolve })
        const before = scope.memo('pending', async () => pending)
        await scope.write(async db => { await db.patch(id, { status: 'indexing' }) })
        complete('success')
        expect(await before).toBe('success')
        expect(await scope.memo('pending', async () => (await scope.get(id))?.status)).toBe('indexing')
      })
    })
  })

  test('unchanged rows and facts are memoized inside one call', async () => {
    const t = convexTest(schema, modules)
    await t.run(async ctx => {
      const id = await document(ctx)
      let reads = 0
      const db = new Proxy(ctx.db, { get(target, property) {
        const method: unknown = Reflect.get(target, property)
        if (property === 'get' && typeof method === 'function') return (...args: unknown[]) => { reads++; return Reflect.apply(method, target, args) }
        return typeof method === 'function' ? method.bind(target) : method
      } })
      await withArtifactLineageInvocation({ ...ctx, db }, async scope => {
        await scope.get(id)
        await scope.get(id)
        let facts = 0
        for (let i = 0; i < 2; i++) await scope.memo('same', async () => { facts++; return { available: true } })
        expect(facts).toBe(1)
      })
      expect(reads).toBe(1)
    })
  })
})

describe('round-4 own-write invalidation', () => {
  test('clears warm rows and facts before an own write', async () => {
    const t = convexTest(schema, modules)
    await t.run(async ctx => {
      const id = await document(ctx)
      await withArtifactLineageInvocation(ctx, async scope => {
        const status = () => scope.memo('status', async () => (await scope.get(id))?.status)
        expect(await status()).toBe('success')
        await scope.write(async db => {
          await db.patch(id, { status: 'indexing' })
          expect(await status()).toBe('indexing')
        })
      })
    })
  })

  test.each(['returned', 'thrown'] as const)('clears rows and facts after an own write that %s', async outcome => {
    const t = convexTest(schema, modules)
    await t.run(async ctx => {
      const id = await document(ctx)
      await withArtifactLineageInvocation(ctx, async scope => {
        const status = () => scope.memo('status', async () => (await scope.get(id))?.status)
        const result = scope.write(async db => {
          expect(await status()).toBe('success')
          await db.patch(id, { status: 'indexing' })
          if (outcome === 'thrown') throw new Error('Own write failed')
        })
        if (outcome === 'thrown') await expect(result).rejects.toThrow('Own write failed')
        else await result
        expect(await status()).toBe('indexing')
      })
    })
  })
})
