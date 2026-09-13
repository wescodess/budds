import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { ref, type Ref } from 'vue'

type MutationReference = FunctionReference<'mutation'>
type ActionReference = FunctionReference<'action'>
type ClientFunctionReference = MutationReference | ActionReference

export interface ConvexMutationState<FunctionRef extends ClientFunctionReference> {
  isLoading: Ref<boolean>
  error: Ref<Error | null>
  mutate: (
    args: FunctionArgs<FunctionRef>,
  ) => Promise<FunctionReturnType<FunctionRef> | undefined>
}

/**
 * Keeps mutation composables type-safe while rendering on the server, where
 * the browser Convex client is intentionally unavailable.
 */
export function createSsrMutationStub<Mutation extends MutationReference>(): ConvexMutationState<Mutation> {
  return createSsrClientFunctionStub<Mutation>()
}

function createSsrClientFunctionStub<FunctionRef extends ClientFunctionReference>(): ConvexMutationState<FunctionRef> {
  return {
    isLoading: ref(false),
    error: ref(null),
    mutate: async () => {
      throw new Error('Convex mutations are client-only')
    },
  }
}

export function createSsrActionStub<Action extends ActionReference>(): ConvexMutationState<Action> {
  return createSsrClientFunctionStub<Action>()
}
