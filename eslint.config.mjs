import { createConfigForNuxt } from '@nuxt/eslint-config'

export default createConfigForNuxt({
  features: {
    stylistic: false,
  },
}).append({
  ignores: [
    '.nuxt/**',
    '.output/**',
    'dist/**',
    'coverage/**',
    'convex/_generated/**',
    'public/**',
  ],
}, {
  // Runtime code is warning-free; regressions in the hardened rule set fail
  // the local and hosted quality gates.
  rules: {
    '@typescript-eslint/no-dynamic-delete': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unsafe-function-type': 'error',
    '@typescript-eslint/no-unused-expressions': 'error',
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/no-useless-constructor': 'error',
    'import/first': 'error',
    'import/no-duplicates': 'error',
    'no-empty': 'error',
    'no-useless-assignment': 'error',
    'no-useless-escape': 'error',
    'prefer-const': 'error',
    // Vue 3 supports fragment templates. The Nuxt config still exposes the
    // legacy Vue 2 rule, which reports valid multi-root components.
    'vue/no-multiple-template-root': 'off',
    // TypeScript optional props are the source of truth for absence. Adding
    // runtime defaults solely to satisfy this rule would change public APIs.
    'vue/require-default-prop': 'off',
  },
}, {
  files: ['**/*.test.ts', 'tests/**/*.ts'],
  rules: {
    // Test doubles intentionally cross framework boundaries whose mock APIs
    // do not preserve application generics. Runtime code remains strict.
    '@typescript-eslint/no-explicit-any': 'off',
  },
})
