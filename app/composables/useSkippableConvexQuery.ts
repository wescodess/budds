import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import type { EffectScope, MaybeRefOrGetter, Ref } from 'vue'

type QueryReference = FunctionReference<'query'>

/**
 * nuxt-convex's useConvexQuery subscribes as soon as it is called and ignores
 * `enabled` on the client, so the query is only created while args exist.
 */
export function useSkippableConvexQuery<Query extends QueryReference>(
  query: Query,
  args: MaybeRefOrGetter<FunctionArgs<Query> | 'skip'>,
) {
  const nuxtApp = useNuxtApp()
  const current = shallowRef<{ data: Ref<FunctionReturnType<Query> | null | undefined> } | null>(null)
  let scope: EffectScope | undefined

  function subscribe(next: FunctionArgs<Query> | 'skip') {
    scope?.stop()
    scope = undefined
    current.value = null
    if (next === 'skip') return
    scope = effectScope(true)
    current.value = scope.run(() => useConvexQuery(query, next)) ?? null
  }

  subscribe(toValue(args))
  watch(
    () => argsKey(toValue(args)),
    () => nuxtApp.runWithContext(() => subscribe(toValue(args))),
  )
  onScopeDispose(() => scope?.stop())

  return {
    data: computed(() => current.value?.data.value ?? null),
  }
}

function argsKey(args: unknown) {
  return args === 'skip' ? args : JSON.stringify(args)
}
