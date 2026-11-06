/// <reference types="vite/client" />
import { asObjectValidator, type GenericValidator, type PropertyValidators } from 'convex/values'
import { expect, test, vi } from 'vitest'

const definitions = vi.hoisted(() => new WeakMap<object, unknown>())

vi.mock('convex/server', async importOriginal => {
  const server = await importOriginal<typeof import('convex/server')>()
  const capture = (builder: (definition: never) => object) => (definition: never) => {
    const registered = builder(definition)
    definitions.set(registered, definition)
    return registered
  }
  return {
    ...server,
    queryGeneric: capture(server.queryGeneric), internalQueryGeneric: capture(server.internalQueryGeneric),
    mutationGeneric: capture(server.mutationGeneric), internalMutationGeneric: capture(server.internalMutationGeneric),
    actionGeneric: capture(server.actionGeneric), internalActionGeneric: capture(server.internalActionGeneric),
  }
})

const modules = import.meta.glob([
  '../../convex/**/*.ts', '!../../convex/**/*.test.ts', '!../../convex/_generated/**', '!../../convex/**/convex.config.ts',
], { eager: true })
const functions: Array<{ name: string, definition: unknown }> = []

function registered(value: unknown): value is object {
  return (typeof value === 'function' || (typeof value === 'object' && value !== null))
    && ['isQuery', 'isMutation', 'isAction'].some(kind => Reflect.get(value, kind) === true)
}

for (const [path, module] of Object.entries(modules)) {
  for (const [name, value] of Object.entries(module as Record<string, unknown>)) {
    if (!registered(value)) continue
    const label = `${path.replace('../../convex/', '').replace(/\.ts$/, '')}:${name}`
    expect(definitions.has(value), `Missing registration definition for ${label}`).toBe(true)
    functions.push({ name: label, definition: definitions.get(value) })
  }
}

function validator(definition: unknown, field: 'args' | 'returns'): GenericValidator | undefined {
  if (typeof definition === 'function') return undefined
  if (!definition || typeof definition !== 'object') throw new Error('Invalid function definition')
  const value: unknown = Reflect.get(definition, field)
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') throw new Error(`Invalid ${field} validator`)
  return asObjectValidator(value as GenericValidator | PropertyValidators)
}

function checkTree(value: GenericValidator, name: string) {
  expect(value.isConvexValidator, name).toBe(true)
  expect(['required', 'optional'], name).toContain(value.isOptional)
  switch (value.kind) {
    case 'object':
      for (const [field, child] of Object.entries(value.fields)) checkTree(child, `${name}.${field}`)
      return
    case 'array': checkTree(value.element, `${name}[]`); return
    case 'union':
      expect(value.members.length, name).toBeGreaterThan(0)
      for (const child of value.members) checkTree(child, name)
      return
    case 'record': checkTree(value.key, `${name}.key`); checkTree(value.value, `${name}.value`); return
    default: expect(['any', 'id', 'float64', 'int64', 'commitTs', 'boolean', 'bytes', 'null', 'string', 'literal'], name).toContain(value.kind)
  }
}

test('every registered query, mutation and action has deployable top-level arguments', () => {
  expect(functions.map(fn => fn.name)).toContain('learnV2Mastery:acceptMasterySubmission')
  for (const fn of functions) {
    const args = validator(fn.definition, 'args')
    if (!args) continue
    expect(['object', 'any'], `${fn.name}: top-level args validator must be object or any`).toContain(args.kind)
    checkTree(args, `${fn.name}.args`)
  }
})

test('every declared return validator has a valid public validator tree', () => {
  for (const fn of functions) {
    const returns = validator(fn.definition, 'returns')
    if (returns) checkTree(returns, `${fn.name}.returns`)
  }
})
