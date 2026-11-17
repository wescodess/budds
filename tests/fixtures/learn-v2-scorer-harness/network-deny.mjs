import { forbidNetwork } from '../../../scripts/lib/learn-v2-scorer/runtime.mjs'

const nativeFetch = globalThis.fetch
// Loaded before the CLI and all of its provider modules in the exit test.
forbidNetwork()

// Exercise native redirect handling with in-memory HTTP dispatchers. Socket
// entry points stay denied; no package or local HTTP server is needed.
export const mockNativeFetch = dispatcher => (url, options) => nativeFetch(url, { ...options, dispatcher })
