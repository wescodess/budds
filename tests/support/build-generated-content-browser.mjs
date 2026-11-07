import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

const bundle = await build({
  configFile: false, logLevel: 'silent',
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false },
  resolve: { alias: { '~': resolve('app'), '@': resolve('app') } },
  plugins: [vue(), {
    name: 'test-local-mermaid',
    enforce: 'pre',
    resolveId(id) { if (id === 'mermaid') return '\0test-local-mermaid' },
    load(id) { if (id === '\0test-local-mermaid') return 'export default globalThis.__mermaidTestModule' },
  }],
  build: { write: false, minify: false, lib: { entry: resolve('tests/support/generated-content-browser.ts'), name: 'GeneratedContentTest', formats: ['iife'] } },
})
const output = Array.isArray(bundle) ? bundle[0] : bundle
const chunk = output.output.find(chunk => chunk.type === 'chunk')
if (!chunk) throw new Error('missing browser entry')
process.stdout.write(chunk.code)
