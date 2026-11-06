import { forbidNetwork } from '../../../scripts/lib/learn-v2-scorer/runtime.mjs'

// Loaded before the CLI and all of its provider modules in the exit test.
forbidNetwork()
