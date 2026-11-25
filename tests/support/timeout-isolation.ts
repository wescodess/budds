import { AsyncLocalStorage } from 'node:async_hooks'
import { afterAll, aroundEach, vi } from 'vitest'
import { getCurrentTest, getFn, setFn } from 'vitest/suite'

type Scope = {
  lifetime: { active: boolean }
  signal?: AbortSignal
  undo: Map<unknown, () => void>
  properties: Map<object, Set<PropertyKey>>
  environment: NodeJS.ProcessEnv
  environmentDescriptors: PropertyDescriptorMap
  globalDescriptors: PropertyDescriptorMap
  wrappers: Set<() => void>
  env: Map<string, string | undefined>
  globals: Map<PropertyKey, PropertyDescriptor | undefined>
}
const scopeKey = Symbol.for('budds.test.timeoutScopes')
const scopes: AsyncLocalStorage<Scope> = Reflect.get(process, scopeKey) ?? new AsyncLocalStorage<Scope>()
Reflect.set(process, scopeKey, scopes)
const pending = () => new Promise<never>(() => {})
const current = () => scopes.getStore()
const storageMethods = typeof Storage === 'undefined' ? undefined : {
  getItem: Storage.prototype.getItem, key: Storage.prototype.key,
  setItem: Storage.prototype.setItem, removeItem: Storage.prototype.removeItem, clear: Storage.prototype.clear,
}
const active = (scope = current()) => !scope || (scope.lifetime.active && !scope.signal?.aborted)

type SharedMock = {
  mock: ReturnType<typeof vi.fn>
  implementation: ReturnType<ReturnType<typeof vi.fn>['getMockImplementation']>
  name: string
  once: Array<{ name: string, args: unknown[] }>
}
const sharedMocks = new Set<WeakRef<SharedMock>>()
function resetSharedMocks() {
  for (const reference of sharedMocks) {
    const shared = reference.deref()
    if (!shared) { sharedMocks.delete(reference); continue }
    shared.mock.mockReset().mockName(shared.name)
    if (shared.implementation) shared.mock.mockImplementation(shared.implementation)
    for (const operation of shared.once) Reflect.apply(Reflect.get(shared.mock, operation.name), shared.mock, operation.args)
  }
}


function track<T>(target: T): T {
  const scope = current()
  if (!scope || !active(scope) || target === null || (typeof target !== 'object' && typeof target !== 'function') || scope.undo.has(target)) return target
  const object = target as Record<PropertyKey, unknown>
  if (storageMethods && target instanceof Storage) {
    const entries = Array.from({ length: target.length }, (_, index) => {
      const key = storageMethods.key.call(target, index)!
      return [key, storageMethods.getItem.call(target, key)!] as const
    })
    scope.undo.set(target, () => {
      storageMethods.clear.call(target)
      for (const [key, value] of entries) storageMethods.setItem.call(target, key, value)
    })
  } else if (target instanceof Map) {
    const raw = (object.__v_isReactive || object.__v_isReadonly) ? object.__v_raw : target
    const entries = [...Map.prototype.entries.call(raw)]
    scope.undo.set(target, () => { Map.prototype.clear.call(raw); for (const [key, value] of entries) Map.prototype.set.call(raw, key, value) })
  } else if (target instanceof Set) {
    const raw = (object.__v_isReactive || object.__v_isReadonly) ? object.__v_raw : target
    const entries = [...Set.prototype.values.call(raw)]
    scope.undo.set(target, () => { Set.prototype.clear.call(raw); for (const value of entries) Set.prototype.add.call(raw, value) })
  } else if (object.__v_isRef === true) {
    const value = object.value
    scope.undo.set(target, () => { object.value = value })
  } else {
    const descriptors = Object.getOwnPropertyDescriptors(target)
    scope.undo.set(target, () => {
      for (const key of Reflect.ownKeys(object)) if (!(key in descriptors)) Reflect.deleteProperty(object, key)
      Object.defineProperties(object, descriptors)
    })
  }
  return target
}

export const timeoutIsolation = {
  track,
  reference<T extends object>(target: T): T {
    return new Proxy(target, {
      get(object, key) { return Reflect.get(object, key, object) },
      set(object, key, value) {
        if (!active()) return true
        timeoutIsolation.property(object, key)
        return Reflect.set(object, key, value, object)
      },
      deleteProperty(object, key) {
        if (!active()) return true
        timeoutIsolation.property(object, key)
        return Reflect.deleteProperty(object, key)
      },
    })
  },
  property(target: object, key: PropertyKey) {
    const scope = current()
    if (!scope || !active(scope)) return
    if (Array.isArray(target)) { track(target); return }
    let keys = scope.properties.get(target)
    if (!keys) { keys = new Set(); scope.properties.set(target, keys) }
    if (keys.has(key)) return
    keys.add(key)
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    const ref = key === 'value' && Reflect.get(target, '__v_isRef') === true
    const value = ref ? Reflect.get(target, key) : undefined
    scope.undo.set({}, () => {
      if (ref) Reflect.set(target, key, value)
      else if (descriptor) Object.defineProperty(target, key, descriptor)
      else Reflect.deleteProperty(target, key)
    })
  },
  mutationTarget<T extends object>(target: T): T {
    return new Proxy(target, {
      get(object, key) {
        const method = Reflect.get(object, key, object)
        if (typeof method !== 'function') return method
        return (...args: unknown[]) => {
          if (!active()) return undefined
          track(object)
          return Reflect.apply(method, object, args)
        }
      },
    })
  },
  builtin(name: string, original: (...args: never[]) => unknown) {
    return (target: object, ...args: unknown[]) => {
      if (!active()) return name.startsWith('Reflect.') ? true : target
      if (name === 'Object.assign') {
        for (const source of args) if (source != null) {
          for (const key of Reflect.ownKeys(Object(source))) {
            if (Object.getOwnPropertyDescriptor(source, key)?.enumerable) timeoutIsolation.property(target, key)
          }
        }
      } else if (name === 'Object.defineProperties') {
        for (const key of Reflect.ownKeys(args[0] as object)) timeoutIsolation.property(target, key)
      } else timeoutIsolation.property(target, args[0] as PropertyKey)
      return Reflect.apply(original, undefined, [target, ...args])
    }
  },
  active,
  factory<T extends (...args: never[]) => unknown>(callback: T): T {
    return function (this: unknown, ...args: never[]) {
      return scopes.exit(() => callback.apply(this, args))
    } as T
  },
  ownWrapper<T extends { unmount: () => void }>(wrapper: T): T {
    const scope = current()
    if (!scope || !Reflect.get(wrapper, '__app')) return wrapper
    const original = wrapper.unmount.bind(wrapper)
    let mounted = true
    const unmount = () => {
      if (!mounted) return
      mounted = false
      scope.wrappers.delete(unmount)
      original()
    }
    wrapper.unmount = unmount
    scope.wrappers.add(unmount)
    if (!active(scope)) unmount()
    return wrapper
  },
  before<T extends (...args: never[]) => unknown>(callback: T): T {
    return function (this: unknown, ...args: never[]) {
      const scope = current()
      if (!scope) return callback.apply(this, args)
      return scopes.run({ ...scope, signal: getCurrentTest()?.context.signal }, () => callback.apply(this, args))
    } as T
  },
  async wait<T>(value: T | PromiseLike<T>): Promise<T> {
    const scope = current()
    try {
      const result = await value
      if (!active(scope)) {
        // Vitest owns the timeout failure; abandoned continuations stay suspended.
        if (result && typeof result === 'object' && 'unmount' in result && typeof result.unmount === 'function') result.unmount()
        return pending()
      }
      return result
    } catch (error) {
      if (!active(scope)) return pending()
      throw error
    }
  },
  bind<T extends (...args: never[]) => unknown>(callback: T): T {
    const scope = current()
    if (!scope) return callback
    return function (this: unknown, ...args: never[]) {
      if (!active(scope) || !active()) return undefined
      return scopes.run(scope, () => callback.apply(this, args))
    } as T
  },
  scalar(key: string, restore: () => void) {
    const scope = current()
    if (scope && active(scope) && !scope.undo.has(key)) scope.undo.set(key, restore)
  },
}

Object.assign(globalThis, { __buddsTimeoutIsolation: timeoutIsolation })

export function createTimeoutScope(signal?: AbortSignal) {
  const scope: Scope = { lifetime: { active: true }, signal, undo: new Map(), properties: new Map(), environment: process.env, environmentDescriptors: Object.getOwnPropertyDescriptors(process.env), globalDescriptors: Object.getOwnPropertyDescriptors(globalThis), wrappers: new Set(), env: new Map(), globals: new Map() }
  return {
    run<T>(callback: () => T): T { return scopes.run(scope, callback) },
    dispose() {
      const errors: unknown[] = []
      for (const unmount of [...scope.wrappers]) { try { unmount() } catch (error) { errors.push(error) } }
      if (errors.length) throw new AggregateError(errors, 'Component cleanup failed')
    },
    close() {
      if (!scope.lifetime.active) return
      scope.lifetime.active = false
      const errors: unknown[] = []
      for (const unmount of [...scope.wrappers]) { try { unmount() } catch (error) { errors.push(error) } }
      const globals = [...scope.globals.keys()]
      for (const restore of [...scope.undo.values()].reverse()) { try { restore() } catch (error) { errors.push(error) } }
      try { restoreStubs(scope) } catch (error) { errors.push(error) }
      for (const key of globals) {
        const descriptor = scope.globalDescriptors[key as string]
        try {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor)
          else Reflect.deleteProperty(globalThis, key)
        } catch (error) { errors.push(error) }
      }
      try {
        process.env = scope.environment
        for (const key of Object.keys(process.env)) if (!(key in scope.environmentDescriptors)) Reflect.deleteProperty(process.env, key)
        Object.defineProperties(process.env, scope.environmentDescriptors)
      } catch (error) { errors.push(error) }
      scope.wrappers.clear()
      scope.undo.clear()
      scope.properties.clear()
      for (const key of Reflect.ownKeys(scope.environmentDescriptors)) Reflect.deleteProperty(scope.environmentDescriptors, key)
      for (const key of Reflect.ownKeys(scope.globalDescriptors)) Reflect.deleteProperty(scope.globalDescriptors, key)
      if (errors.length) throw new AggregateError(errors, 'Test isolation cleanup failed')
    },
    scope,
  }
}

const nativeKey = Symbol.for('budds.test.nativeVi')
const nativeVi: typeof vi = Reflect.get(vi, nativeKey) ?? { ...vi }
if (!Reflect.has(vi, nativeKey)) Object.defineProperty(vi, nativeKey, { value: nativeVi })
const mocksKey = Symbol.for('budds.test.guardedMocks')
const guardedMocks: WeakMap<object, object> = Reflect.get(vi, mocksKey) ?? new WeakMap()
if (!Reflect.has(vi, mocksKey)) Object.defineProperty(vi, mocksKey, { value: guardedMocks })

function guardMock<T extends (...args: never[]) => unknown>(mock: T, fallback?: (...args: never[]) => unknown): T {
  const previous = guardedMocks.get(mock)
  if (previous) return previous as T
  const native = mock as unknown as ReturnType<typeof vi.fn>
  const shared: SharedMock | undefined = current() ? undefined : { mock: native, implementation: native.getMockImplementation(), name: native.getMockName(), once: [] }
  if (shared) sharedMocks.add(new WeakRef(shared))
  const proxy: T = new Proxy(mock, {
    apply(target, receiver, args) {
      if (!active()) return fallback ? Reflect.apply(fallback, receiver, args) : undefined
      if (shared && !current()) shared.once.shift()
      return Reflect.apply(target, receiver, args)
    },
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      if (typeof key !== 'string' || !key.startsWith('mock') || typeof value !== 'function') return value
      return (...args: unknown[]) => {
        if (!active()) return proxy
        const result = Reflect.apply(value, target, args)
        if (shared && !current()) {
          if (key.endsWith('Once')) shared.once.push({ name: key, args })
          if (key === 'mockReset' || key === 'mockRestore') shared.once = []
          shared.implementation = native.getMockImplementation()
          shared.name = native.getMockName()
        }
        return result === target ? proxy : result
      }
    },
  })
  guardedMocks.set(mock, proxy)
  guardedMocks.set(proxy, proxy)
  return proxy
}

vi.fn = new Proxy(nativeVi.fn, {
  apply(target, receiver, args) { return guardMock(Reflect.apply(target, receiver, args)) },
})
vi.spyOn = new Proxy(nativeVi.spyOn, {
  apply(target, receiver, args) {
    if (!active()) return undefined
    const [object, key, kind] = args
    let parent = object
    let prior: PropertyDescriptor | undefined
    while (parent && !prior) { prior = Object.getOwnPropertyDescriptor(parent, key); parent = Object.getPrototypeOf(parent) }
    const fallback = kind ? prior?.[kind as 'get' | 'set'] : Reflect.get(object, key)
    const mock = Reflect.apply(target, receiver, args)
    const scope = current()
    if (scope) scope.undo.set(mock, () => { mock.mockRestore() })
    const clockRead = (object === Date && key === 'now') || object === Math
      || (typeof performance !== 'undefined' && object === performance && key === 'now')
    const proxy = guardMock(mock, clockRead && typeof fallback === 'function' ? fallback : undefined)
    const descriptor = Object.getOwnPropertyDescriptor(object, key)!
    if (kind) Object.defineProperty(object, key, { ...descriptor, [kind]: proxy })
    else if ('value' in descriptor) Object.defineProperty(object, key, { ...descriptor, value: proxy })
    else Object.defineProperty(object, key, { ...descriptor, get: () => proxy })
    return proxy
  },
})
function restoreStubs(scope: Scope, kind?: 'env' | 'globals') {
  if (!kind || kind === 'env') {
    for (const [name, value] of scope.env) {
      if (value === undefined) Reflect.deleteProperty(import.meta.env, name)
      else import.meta.env[name] = value
    }
    scope.env.clear()
  }
  if (!kind || kind === 'globals') {
    for (const [name, descriptor] of scope.globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
    scope.globals.clear()
  }
}

for (const name of ['stubEnv', 'unstubAllEnvs', 'stubGlobal', 'unstubAllGlobals', 'restoreAllMocks', 'resetAllMocks', 'clearAllMocks', 'useFakeTimers', 'useRealTimers', 'setSystemTime', 'runAllTimers', 'runAllTimersAsync', 'advanceTimersByTime', 'advanceTimersByTimeAsync', 'advanceTimersToNextTimer', 'advanceTimersToNextTimerAsync', 'runOnlyPendingTimers', 'runOnlyPendingTimersAsync', 'clearAllTimers'] as const) {
  const original = nativeVi[name]
  Object.defineProperty(vi, name, { configurable: true, writable: true, value: (...args: unknown[]) => {
    if (!active()) return vi
    const scope = current()
    if (!scope) {
      const result = Reflect.apply(original, vi, args)
      return result
    }
    if (name === 'stubEnv') {
      const key = args[0] as string
      if (!scope.env.has(key)) scope.env.set(key, import.meta.env[key])
      const value = args[1]
      if (['PROD', 'DEV', 'SSR'].includes(key)) import.meta.env[key] = value ? '1' : ''
      else if (value === undefined) Reflect.deleteProperty(import.meta.env, key)
      else import.meta.env[key] = String(value)
      return vi
    }
    if (name === 'unstubAllEnvs') { restoreStubs(scope, 'env'); return vi }
    if (name === 'stubGlobal') {
      const key = args[0] as PropertyKey
      if (!scope.globals.has(key)) scope.globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
      Object.defineProperty(globalThis, key, { value: args[1], configurable: true, writable: true, enumerable: true })
      return vi
    }
    if (name === 'unstubAllGlobals') { restoreStubs(scope, 'globals'); return vi }
    const result = Reflect.apply(original, vi, args)
    return result
  } })
}

const fileEnvironment = Object.getOwnPropertyDescriptors(process.env)
afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const key of Object.keys(process.env)) if (!(key in fileEnvironment)) Reflect.deleteProperty(process.env, key)
  Object.defineProperties(process.env, fileEnvironment)
})

if (storageMethods) {
  for (const name of ['setItem', 'removeItem', 'clear'] as const) {
    const original = storageMethods[name]
    Object.defineProperty(Storage.prototype, name, { configurable: true, writable: true, value: function (this: Storage, ...args: string[]) {
      if (!active()) return
      track(this)
      return Reflect.apply(original, this, args)
    } })
  }
}

aroundEach(async (runTest, context) => {
  if (/\/(?:convex\/.*\.test\.ts|tests\/component\/)/.test(context.task.file.filepath)) resetSharedMocks()
  const owner = createTimeoutScope()
  const fakeTimers = vi.isFakeTimers()
  const original = getFn(context.task)
  setFn(context.task, () => scopes.run({ ...owner.scope, signal: context.signal }, async () => {
    try { await original() } finally { owner.run(owner.dispose) }
  }))
  try {
    await owner.run(runTest)
  } finally {
    setFn(context.task, original)
    try { owner.close() } finally {
      if (!fakeTimers && vi.isFakeTimers()) vi.useRealTimers()
    }
  }
})

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(fulfill => { resolve = fulfill })
  return { promise, resolve }
}
