import { AsyncLocalStorage } from 'node:async_hooks'
import { aroundEach, vi } from 'vitest'

type Scope = {
  lifetime: { active: boolean, recording: boolean }
  signal?: AbortSignal
  undo: Map<unknown, () => void>
  properties: Map<object, Set<PropertyKey>>
  environment: NodeJS.ProcessEnv
  environmentDescriptors: PropertyDescriptorMap
  wrappers: Set<() => void>
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

function track<T>(target: T): T {
  const scope = current()
  if (!scope || !scope.lifetime.recording || !active(scope) || target === null || (typeof target !== 'object' && typeof target !== 'function') || scope.undo.has(target)) return target
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
    if (!scope || !scope.lifetime.recording || !active(scope)) return
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
    if (!active(scope)) wrapper.unmount()
    else if (scope.lifetime.recording) scope.wrappers.add(wrapper.unmount.bind(wrapper))
    return wrapper
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
    if (scope && scope.lifetime.recording && active(scope) && !scope.undo.has(key)) scope.undo.set(key, restore)
  },
}

Object.assign(globalThis, { __buddsTimeoutIsolation: timeoutIsolation })

export function createTimeoutScope(signal?: AbortSignal) {
  const scope: Scope = { lifetime: { active: true, recording: true }, signal, undo: new Map(), properties: new Map(), environment: process.env, environmentDescriptors: Object.getOwnPropertyDescriptors(process.env), wrappers: new Set() }
  const fakeTimers = vi.isFakeTimers()
  const release = () => {
    scope.lifetime.recording = false
    scope.wrappers.clear()
    scope.undo.clear()
    scope.properties.clear()
    for (const key of Reflect.ownKeys(scope.environmentDescriptors)) Reflect.deleteProperty(scope.environmentDescriptors, key)
  }
  return {
    run<T>(callback: () => T): T { return scopes.run(scope, callback) },
    release,
    close() {
      scope.lifetime.active = false
      if (!scope.lifetime.recording) return
      const errors: unknown[] = []
      for (const unmount of scope.wrappers) { try { unmount() } catch (error) { errors.push(error) } }
      for (const restore of [...scope.undo.values()].reverse()) { try { restore() } catch (error) { errors.push(error) } }
      try {
        process.env = scope.environment
        for (const key of Object.keys(process.env)) if (!(key in scope.environmentDescriptors)) Reflect.deleteProperty(process.env, key)
        Object.defineProperties(process.env, scope.environmentDescriptors)
        if (!fakeTimers && vi.isFakeTimers()) nativeVi.useRealTimers()
      } catch (error) { errors.push(error) }
      release()
      if (errors.length) throw new AggregateError(errors, 'Aborted test rollback failed')
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
  let once: Array<{ name: string, args: unknown[] }> = []
  const snapshot = () => {
    const scope = current()
    if (!scope || !scope.lifetime.recording || scope.undo.has(native)) return
    const implementation = native.getMockImplementation()
    const name = native.getMockName()
    const savedOnce = once.slice()
    const history = Object.entries(native.mock).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.slice()] as const)
    scope.undo.set(native, () => {
      native.mockReset().mockName(name)
      if (implementation) native.mockImplementation(implementation)
      for (const operation of savedOnce) Reflect.apply(Reflect.get(native, operation.name), native, operation.args)
      for (const [key, value] of history) Reflect.get(native.mock, key).splice(0, Infinity, ...value)
      once = savedOnce
    })
  }
  const proxy: T = new Proxy(mock, {
    apply(target, receiver, args) {
      if (!active()) return fallback ? Reflect.apply(fallback, receiver, args) : undefined
      snapshot()
      once.shift()
      return Reflect.apply(target, receiver, args)
    },
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      if (typeof key !== 'string' || !key.startsWith('mock') || typeof value !== 'function') return value
      return (...args: unknown[]) => {
        if (!active()) return proxy
        snapshot()
        const result = Reflect.apply(value, target, args)
        if (key.endsWith('Once')) once.push({ name: key, args })
        if (key === 'mockReset' || key === 'mockRestore') once = []
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
    if (scope && scope.lifetime.recording) scope.undo.set(mock, () => { mock.mockRestore() })
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
for (const name of ['stubEnv', 'unstubAllEnvs', 'stubGlobal', 'unstubAllGlobals', 'restoreAllMocks', 'resetAllMocks', 'clearAllMocks', 'useFakeTimers', 'useRealTimers', 'setSystemTime', 'runAllTimers', 'runAllTimersAsync', 'advanceTimersByTime', 'advanceTimersByTimeAsync', 'advanceTimersToNextTimer', 'advanceTimersToNextTimerAsync', 'runOnlyPendingTimers', 'runOnlyPendingTimersAsync', 'clearAllTimers'] as const) {
  const original = nativeVi[name]
  Object.defineProperty(vi, name, { configurable: true, writable: true, value: (...args: unknown[]) => {
    if (!active()) return vi
    if (name === 'stubGlobal') timeoutIsolation.property(globalThis, args[0] as PropertyKey)
    const result = Reflect.apply(original, vi, args)
    return result
  } })
}

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
  const owner = createTimeoutScope(context.signal)
  try {
    await owner.run(runTest)
  } finally {
    if (context.signal.aborted) owner.close()
    else owner.release()
  }
})

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(fulfill => { resolve = fulfill })
  return { promise, resolve }
}
