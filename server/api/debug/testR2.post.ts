import { fetchFolderDocs } from '../../utils/r2-folder'
import { getConvexTokenIdentifier } from '../../utils/convex-identity'

export default defineEventHandler(async (event) => {
    const body = await readBody(event)

    try {
        const docs = await fetchFolderDocs({
            userId: body.userId,
            folderId: body.folderId,
            maxChars: 80000
        })
        return { success: true, count: docs.length, docs: docs.map(d => d.key) }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
})
