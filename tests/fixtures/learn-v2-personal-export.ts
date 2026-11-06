import type { convexTest } from 'convex-test'
import { api } from '../../convex/_generated/api'

type Owner = ReturnType<ReturnType<typeof convexTest>['withIdentity']>
export async function authorizeExport(owner: Owner) {
  let result = await owner.mutation(api.dataExport.authorizePersonalExport, {})
  while (!result.done) result = await owner.mutation(api.dataExport.authorizePersonalExport, {
    authorizationId: result.authorizationId, cursor: result.cursor ?? undefined,
  })
  return result.authorizationId
}
