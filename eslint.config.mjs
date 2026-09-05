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
    'vue/no-multiple-template-root': 'warn',
  },
})
