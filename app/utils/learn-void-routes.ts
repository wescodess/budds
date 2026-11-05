import type { LocationQueryRaw, RouteLocationNamedRaw } from 'vue-router'

export const LEARN_VOID_ROUTE_NAME = 'app-learn-void-threadId'

export function learnVoidRoute(threadId: string, query?: LocationQueryRaw, hash?: string): RouteLocationNamedRaw {
  return { name: LEARN_VOID_ROUTE_NAME, params: { threadId }, ...(query ? { query } : {}), ...(hash ? { hash } : {}) }
}
