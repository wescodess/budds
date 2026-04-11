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
  })

  describe('AC5: Session persistence — config assertions', () => {
    test('nuxt config protects /app/** for authenticated users', async () => {
      const fs = await import('fs')
      const configSource = fs.readFileSync('./nuxt.config.ts', 'utf-8')
      expect(configSource).toMatch(/['"]\/app\/\*\*['"]\s*:\s*\{\s*auth:\s*['"]user['"]/)
    })

    test('nuxt config sets /login as guest-only route', async () => {
      const fs = await import('fs')
      const configSource = fs.readFileSync('./nuxt.config.ts', 'utf-8')
      expect(configSource).toMatch(/['"]\/login['"]\s*:\s*\{\s*auth:\s*['"]guest['"]/)
    })

    test('nuxt config redirects logout to /login', async () => {
      const fs = await import('fs')
      const configSource = fs.readFileSync('./nuxt.config.ts', 'utf-8')
      expect(configSource).toMatch(/logout:\s*['"]\/login['"]/)
    })

    test('nuxt config redirects guest to /app', async () => {
      const fs = await import('fs')
      const configSource = fs.readFileSync('./nuxt.config.ts', 'utf-8')
      expect(configSource).toMatch(/guest:\s*['"]\/app['"]/)
    })
  })
})
