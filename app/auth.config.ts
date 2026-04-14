import { defineClientAuth } from '@onmax/nuxt-better-auth/config'
import { convexClient } from '@convex-dev/better-auth/client/plugins'

export default defineClientAuth({
  plugins: [convexClient()],
})
