import { query } from './_generated/server'
export default query(async (ctx) => {
    return await ctx.db.query('documents').order('desc').take(2)
})
