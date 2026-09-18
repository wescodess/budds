/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test, describe } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const TEST_IDENTITY = {
  tokenIdentifier: 'https://localhost:3002|google-oauth2|12345',
  subject: 'google-oauth2|12345',
  issuer: 'https://localhost:3002',
  name: 'Test Student',
  email: 'student@example.com',
  pictureUrl: 'https://example.com/avatar.jpg',
}

describe('Story 1.1 — Verify & Harden Authentication Flow', () => {
  describe('AC3: Google OAuth creates or updates user in Convex', () => {
    test('upsertUser creates a new user record on first login', async () => {
      const t = convexTest(schema, modules)
      const asUser = t.withIdentity(TEST_IDENTITY)

      const userId = await asUser.mutation(api.users.upsertUser, {})
      expect(userId).toBeDefined()

      const user = await asUser.query(api.users.getUser, {})
      expect(user).not.toBeNull()
      expect(user!.tokenIdentifier).toBe(TEST_IDENTITY.tokenIdentifier)
      expect(user!.name).toBe('Test Student')
      expect(user!.email).toBe('student@example.com')
      expect(user!.avatarUrl).toBe('https://example.com/avatar.jpg')
    })

    test('upsertUser grants the disposable local E2E cohort only under the loopback guard', async () => {
      const previous = {
        BUDDS_E2E_MODE: process.env.BUDDS_E2E_MODE,
        BUDDS_E2E_AUTH_TOKEN: process.env.BUDDS_E2E_AUTH_TOKEN,
        CONVEX_CLOUD_URL: process.env.CONVEX_CLOUD_URL,
      }
      process.env.BUDDS_E2E_MODE = 'true'
      process.env.BUDDS_E2E_AUTH_TOKEN = 'a'.repeat(32)
      process.env.CONVEX_CLOUD_URL = 'http://127.0.0.1:3210'
      try {
        const t = convexTest(schema, modules)
        const asUser = t.withIdentity(TEST_IDENTITY)
        await asUser.mutation(api.users.upsertUser, {})
        const entitlement = await t.run(async (ctx) => (
          await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', TEST_IDENTITY.tokenIdentifier)).unique()
        )?.learnV2Entitlement)
        expect(entitlement?.enabled).toBe(true)
      }
      finally {
        for (const [name, value] of Object.entries(previous)) {
          if (value === undefined) Reflect.deleteProperty(process.env, name)
          else process.env[name] = value
        }
      }
    })

    test('upsertUser updates existing user record on subsequent login', async () => {
      const t = convexTest(schema, modules)
      const asUser = t.withIdentity(TEST_IDENTITY)

      await asUser.mutation(api.users.upsertUser, {})

      const updatedIdentity = {
        ...TEST_IDENTITY,
        name: 'Updated Student',
        pictureUrl: 'https://example.com/new-avatar.jpg',
      }
      const asUpdatedUser = t.withIdentity(updatedIdentity)
      await asUpdatedUser.mutation(api.users.upsertUser, {})

      const user = await asUpdatedUser.query(api.users.getUser, {})
      expect(user).not.toBeNull()
      expect(user!.name).toBe('Updated Student')
      expect(user!.avatarUrl).toBe('https://example.com/new-avatar.jpg')
      expect(user!.email).toBe('student@example.com')
    })

    test('upsertUser is idempotent — does not create duplicate records', async () => {
      const t = convexTest(schema, modules)
      const asUser = t.withIdentity(TEST_IDENTITY)

      const firstId = await asUser.mutation(api.users.upsertUser, {})
      const secondId = await asUser.mutation(api.users.upsertUser, {})
      expect(firstId).toBe(secondId)
    })

    test('upsertUser handles missing optional fields gracefully', async () => {
      const minimalIdentity = {
        tokenIdentifier: 'https://localhost:3002|google-oauth2|99999',
        subject: 'google-oauth2|99999',
        issuer: 'https://localhost:3002',
      }
      const t = convexTest(schema, modules)
      const asUser = t.withIdentity(minimalIdentity)

      await asUser.mutation(api.users.upsertUser, {})

      const user = await asUser.query(api.users.getUser, {})
      expect(user).not.toBeNull()
      expect(user!.name).toBe('Unknown')
      expect(user!.email).toBeUndefined()
      expect(user!.avatarUrl).toBeUndefined()
    })

    test('upsertUser rejects unauthenticated calls', async () => {
      const t = convexTest(schema, modules)
      await expect(
        t.mutation(api.users.upsertUser, {}),
      ).rejects.toThrow('Unauthenticated')
    })
  })

  describe('AC4: Sign-out — getUser returns null when unauthenticated', () => {
    test('getUser returns null for unauthenticated requests', async () => {
      const t = convexTest(schema, modules)
      const user = await t.query(api.users.getUser, {})
      expect(user).toBeNull()
    })

    test('getUser returns user only for the authenticated identity', async () => {
      const t = convexTest(schema, modules)
      const asUser = t.withIdentity(TEST_IDENTITY)

      await asUser.mutation(api.users.upsertUser, {})

      const otherIdentity = {
        tokenIdentifier: 'https://localhost:3002|google-oauth2|other',
        subject: 'google-oauth2|other',
        issuer: 'https://localhost:3002',
      }
      const asOther = t.withIdentity(otherIdentity)
      const otherUser = await asOther.query(api.users.getUser, {})
      expect(otherUser).toBeNull()
    })

    test('getUser never exposes the private Learn V2 cohort entitlement', async () => {
      const t = convexTest(schema, modules)
      const asUser = t.withIdentity(TEST_IDENTITY)
      await asUser.mutation(api.users.upsertUser, {})
      await t.run(async (ctx) => {
        const user = await ctx.db
          .query('users')
          .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', TEST_IDENTITY.tokenIdentifier))
          .unique()
        await ctx.db.patch(user!._id, {
          learnV2Entitlement: { enabled: true, updatedAt: 123 },
        })
      })

      const user = await asUser.query(api.users.getUser, {})

      expect(user).toEqual(expect.objectContaining({
        tokenIdentifier: TEST_IDENTITY.tokenIdentifier,
        name: TEST_IDENTITY.name,
        email: TEST_IDENTITY.email,
        avatarUrl: TEST_IDENTITY.pictureUrl,
      }))
      expect(user).not.toHaveProperty('learnV2Entitlement')
    })
  })

  describe('AC5: Session persistence — config assertions', () => {
    test('nuxt config protects /app/** for authenticated users', async () => {
      const fs = await import('fs')
      const configSource = fs.readFileSync('./nuxt.config.ts', 'utf-8')
      expect(configSource).toMatch(/const serverAuthEnabled\s*=\s*process\.env\.NODE_ENV\s*!==\s*['"]development['"]/)
      expect(configSource).toMatch(/['"]\/app\/\*\*['"]\s*:\s*\{\s*auth:\s*serverAuthEnabled\s*\?\s*['"]user['"]/)
    })

    test('nuxt config sets /login as guest-only route', async () => {
      const fs = await import('fs')
      const configSource = fs.readFileSync('./nuxt.config.ts', 'utf-8')
      expect(configSource).toMatch(/const serverAuthEnabled\s*=\s*process\.env\.NODE_ENV\s*!==\s*['"]development['"]/)
      expect(configSource).toMatch(/['"]\/login['"]\s*:\s*\{\s*auth:\s*serverAuthEnabled\s*\?\s*['"]guest['"]/)
    })

    test('nuxt config redirects logout to /login', async () => {
      const fs = await import('fs')
      const configSource = fs.readFileSync('./nuxt.config.ts', 'utf-8')
      expect(configSource).toMatch(/logout:\s*['"]\/login['"]/)
    })

    test('nuxt config redirects guest to /app', async () => {
      const fs = await import('fs')
      const configSource = fs.readFileSync('./nuxt.config.ts', 'utf-8')
      expect(configSource).toMatch(/guest:\s*['"]\/['"]/)
    })
  })

  describe('Phase 3: audio overview daily quota', () => {
    test('[P0] getDailyQuota returns null for unauthenticated callers', async () => {
      const t = convexTest(schema, modules)
      const result = await t.query(api.users.getDailyQuota, {})
      expect(result).toBeNull()
    })

    test('[P0] getDailyQuota reports zero used for a fresh user', async () => {
      const t = convexTest(schema, modules)
      const asUser = t.withIdentity({ tokenIdentifier: 'https://auth.example.com|u1', name: 'U' })
      await asUser.mutation(api.users.upsertUser, {})
      const result = await asUser.query(api.users.getDailyQuota, {})
      expect(result).not.toBeNull()
      expect(result!.used).toBe(0)
      expect(result!.cap).toBe(100)
      expect(result!.date).toBe(new Date().toISOString().slice(0, 10))
    })

    test('[P0] incrementDailyQuota increments count and persists today date', async () => {
      const t = convexTest(schema, modules)
      const asUser = t.withIdentity({ tokenIdentifier: 'https://auth.example.com|u1', name: 'U' })
      await asUser.mutation(api.users.upsertUser, {})

      const after1 = await asUser.mutation(api.users.incrementDailyQuota, {})
      expect(after1.used).toBe(1)
      const after2 = await asUser.mutation(api.users.incrementDailyQuota, {})
      expect(after2.used).toBe(2)

      const quota = await asUser.query(api.users.getDailyQuota, {})
      expect(quota!.used).toBe(2)
    })

    test('[P0] getDailyQuota resets used to 0 when stored date is stale', async () => {
      const t = convexTest(schema, modules)
      const asUser = t.withIdentity({ tokenIdentifier: 'https://auth.example.com|u1', name: 'U' })
      await asUser.mutation(api.users.upsertUser, {})
      await asUser.mutation(api.users.incrementDailyQuota, {})

      await t.run(async (ctx) => {
        const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', 'https://auth.example.com|u1')).unique()
        await ctx.db.patch(user!._id, {
          audioOverviewQuota: { date: '2000-01-01', count: 42 },
        })
      })

      const result = await asUser.query(api.users.getDailyQuota, {})
      expect(result!.used).toBe(0)
      expect(result!.cap).toBe(100)
    })

    test('[P0] incrementDailyQuota resets count when stored date is stale', async () => {
      const t = convexTest(schema, modules)
      const asUser = t.withIdentity({ tokenIdentifier: 'https://auth.example.com|u1', name: 'U' })
      await asUser.mutation(api.users.upsertUser, {})

      await t.run(async (ctx) => {
        const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', 'https://auth.example.com|u1')).unique()
        await ctx.db.patch(user!._id, {
          audioOverviewQuota: { date: '2000-01-01', count: 99 },
        })
      })

      const result = await asUser.mutation(api.users.incrementDailyQuota, {})
      expect(result.used).toBe(1)
    })

    test('[P0] incrementDailyQuota rejects unauthenticated callers', async () => {
      const t = convexTest(schema, modules)
      await expect(t.mutation(api.users.incrementDailyQuota, {})).rejects.toThrow(/Unauthenticated/)
    })
  })
})
