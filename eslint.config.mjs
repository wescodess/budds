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
  // The repository predates this lint gate. Preserve the full Nuxt ruleset,
  // but report the known legacy debt as warnings until it is paid down.
  rules: {
    '@typescript-eslint/no-dynamic-delete': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unsafe-function-type': 'warn',
    '@typescript-eslint/no-unused-expressions': 'warn',
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/no-useless-constructor': 'warn',
    'import/first': 'warn',
    'import/no-duplicates': 'warn',
    'no-empty': 'warn',
    'no-useless-assignment': 'warn',
    'no-useless-escape': 'warn',
    'prefer-const': 'warn',
    // Vue 3 supports fragment templates. The Nuxt config still exposes the
    // legacy Vue 2 rule, which reports valid multi-root components.
    'vue/no-multiple-template-root': 'off',
    // TypeScript optional props are the source of truth for absence. Adding
    // runtime defaults solely to satisfy this rule would change public APIs.
    'vue/require-default-prop': 'off',
  },
})
