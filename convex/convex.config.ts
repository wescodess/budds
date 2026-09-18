import { defineApp } from 'convex/server'
import { v } from 'convex/values'
import betterAuth from '@convex-dev/better-auth/convex.config'

const app = defineApp({
  env: {
    BUDDS_E2E_MODE: v.optional(v.string()),
    BUDDS_E2E_AUTH_TOKEN: v.optional(v.string()),
  },
})
app.use(betterAuth, {
  env: {
    BUDDS_E2E_MODE: app.env.BUDDS_E2E_MODE,
    BUDDS_E2E_AUTH_TOKEN: app.env.BUDDS_E2E_AUTH_TOKEN,
  },
})

export default app
