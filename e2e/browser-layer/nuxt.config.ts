import { browserDependencyIncludes } from './dependencies'

// Load the client imports seen in cold-start optimizer failures before either
// browser journey starts. Late discovery invalidates modules during hydration.
export default defineNuxtConfig({
  vite: {
    optimizeDeps: {
      include: browserDependencyIncludes,
    },
  },
})
