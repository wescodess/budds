import Database from 'better-sqlite3'
import { defineServerAuth } from '@onmax/nuxt-better-auth/config'

export default defineServerAuth({
  database: new Database('./data/auth.db'),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
})
