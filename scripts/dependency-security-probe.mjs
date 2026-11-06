import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const nuxtRequire = createRequire(require.resolve('nuxt/package.json'))
const nitroRequire = createRequire(nuxtRequire.resolve('nitropack/package.json'))
const eslintRequire = createRequire(import.meta.resolve('@nuxt/eslint-config'))
const mermaidRequire = createRequire(require.resolve('mermaid'))
const resolverEntry = nitroRequire.resolve('@rollup/plugin-node-resolve')
const resolverRoot = join(dirname(resolverEntry), '../..')
const importXEntry = eslintRequire.resolve('eslint-plugin-import-x')
const importXRoot = join(dirname(importXEntry), '..')
const katexEntry = mermaidRequire.resolve('katex')
const katexRoot = join(dirname(katexEntry), '..')
const { rollup } = createRequire(resolverEntry)('rollup')
const { Linter } = require('eslint')
const hash = value => createHash('sha256').update(value).digest('hex')

// Frozen outputs recorded from the integrity-pinned, unpatched KaTeX 0.16.47.
const benignCases = [
  ['x^2 + y^2 = z^2', {}],
  ['\\frac{1}{2} + \\sqrt{x}', { displayMode: true }],
  ['\\sum_{i=1}^{n} i', { output: 'html' }],
  ['\\int_0^1 x^2 \\, dx', { output: 'mathml' }],
  ['\\text{Hello} \\color{blue}{x}', { throwOnError: false }],
  ['\\RR + \\RR', { macros: { '\\RR': '\\mathbb{R}' } }],
  ['\\href{https://example.invalid/}{x}', { trust: true }],
  ['\\def\\foo{x}{\\def\\foo{y}\\foo}\\foo', {}],
]
const benignHashes = [
  "8f366e463c217a79990f6d5c0b14cd6f1381fdb9cab79ce46967954068661a01",
  "9d5deb40f0779217188bcb215475c1d419e3eccaa3fd95b9420083095987bae0",
  "4cd46e45b68ffcf08abb3baa537cabe7d092eccdda112f326e19ec15fb5df805",
  "ec9cd7b1e6aa3cb3972ef7bae97ce444b48226442ebef3e44fc744e6b4dfa73d",
  "ca8ae4597024b78f196ae9994b828e56e24f6dca8c7c2d6bf9b52c40f8759b06",
  "e66478a58bf1a1d65e586ceb6f928cb2849b991e94f9fd3d757c6266810d69a9",
  "4938da7c48ae11639942d0a374204b7b4686ca7f1a12329cd98e0f76fef264a4",
  "23aa6e06022458bb58bca9a4253f78f6cf8c45e8d7ab240dab8636c879897a46"
]
const assetHash = '458d42783976ced1aea747ab677044fff67f45bff19f0dedcdc72d5444915187'

function assetDigest(root) {
  const entries = []
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.(?:css|woff2?|ttf|otf|png|svg)$/.test(entry.name)) {
        entries.push([relative(root, file), hash(readFileSync(file))])
      }
    }
  }
  walk(root)
  return hash(JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b))))
}

const fixture = mkdtempSync(join(tmpdir(), 'budds-dependency-contract-'))
function put(file, content) {
  const path = join(fixture, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}
put('package.json', '{"name":"dependency-contract","type":"module"}')
const importer = put('src/entry.js', '')
put('src/value.mjs', 'export default "mjs-default"')
put('src/value.js', 'export default "js-default"')
put('src/custom.custom', 'export default "custom-extension"')
put('node_modules/contract-pkg/package.json', '{"name":"contract-pkg","main":"index.js"}')
put('node_modules/contract-pkg/index.js', 'export default "standard-package"')
put('vendor_modules/contract-custom/package.json', '{"name":"contract-custom","main":"index.js"}')
put('vendor_modules/contract-custom/index.js', 'export default "custom-directory"')
put('node_modules/@scope/contract/index.js', 'export default 1')
put('node_modules/@scope/contract/private.js', 'export default 1')
for (const path of ['.hidden.js', 'lib/private.js', 'lib/private/nested.js', 'lib/public.js', 'lib/nested/deep.js', 'lib/.hidden.js', 'lib/[oops.js']) {
  put(`node_modules/contract-pkg/${path}`, 'export default 1')
}
const windowsResolver = put('windows-resolver.cjs', `
exports.interfaceVersion = 2;
exports.resolve = source => ({ found: true, path: 'C:\\\\contracts\\\\' + source.replaceAll('/', '\\\\') + '.js' });
`)

try {
  await test('Resolved graph: deepmerge is removed', () => {
    const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
    assert.doesNotMatch(lock, /^ {2}deepmerge@/m)
  })
  for (const format of ['ESM', 'CJS']) {
    const resolver = format === 'ESM'
      ? await import(pathToFileURL(join(resolverRoot, 'dist/es/index.js')))
      : require(resolverEntry)
    await test(`Rollup ${format}: defaults and frozen copied arrays`, () => {
      const defaults = resolver.DEFAULTS
      assert.deepEqual(defaults, {
        dedupe: [], extensions: ['.mjs', '.js', '.json', '.node'], resolveOnly: [],
        moduleDirectories: ['node_modules'], modulePaths: [], ignoreSideEffectsForRoot: false,
        allowExportsFolderMapping: true,
      })
      assert.ok(Object.isFrozen(defaults))
      for (const value of Object.values(defaults).filter(Array.isArray)) {
        assert.ok(Object.isFrozen(value))
        assert.throws(() => value.push('mutated'), TypeError)
      }
      assert.throws(() => { defaults.ignoreSideEffectsForRoot = true }, TypeError)
      assert.equal(typeof resolver.nodeResolve, 'function')
      assert.equal(typeof resolver.default, 'function')
    })
    for (const [name, source, options, expected] of [
      ['extension order', './value', {}, 'mjs-default'],
      ['standard package', 'contract-pkg', {}, 'standard-package'],
      ['custom extension order', './value', { extensions: ['.js', '.mjs'] }, 'js-default'],
      ['custom extensions', './custom', { extensions: ['.custom'] }, 'custom-extension'],
      ['custom module directories', 'contract-custom', { moduleDirectories: ['vendor_modules'] }, 'custom-directory'],
    ]) {
      await test(`Rollup ${format}: actual bundle ${name}`, async () => {
        const entry = put('src/bundle.js', `import value from ${JSON.stringify(source)}; export default value;`)
        const before = JSON.stringify(options)
        for (const value of Object.values(options)) if (Array.isArray(value)) Object.freeze(value)
        Object.freeze(options)
        const bundle = await rollup({ input: entry, plugins: [resolver.nodeResolve(options)] })
        try {
          const result = await bundle.generate({ format: 'es' })
          assert.ok(result.output[0].code.includes(expected))
        }
        finally { await bundle.close() }
        assert.equal(JSON.stringify(options), before)
        assert.deepEqual(resolver.DEFAULTS.extensions, ['.mjs', '.js', '.json', '.node'])
        assert.deepEqual(resolver.DEFAULTS.moduleDirectories, ['node_modules'])
      })
    }
    await test(`Rollup ${format}: invalid moduleDirectories still rejected`, () => {
      assert.throws(() => resolver.nodeResolve({ moduleDirectories: ['a/b'] }), /must only contain directory names/)
    })
  }

  // Exercise the exported plugin through ESLint, with files that really resolve.
  const ruleCases = [
    ['default forbids internals', 'contract-pkg/lib/private', undefined, 1],
    ['package root allowed', 'contract-pkg', undefined, 0],
    ['allow empty', 'contract-pkg/lib/private', { allow: [] }, 1],
    ['forbid empty', 'contract-pkg/lib/private', { forbid: [] }, 0],
    ['scoped root', '@scope/contract', { allow: [] }, 0],
    ['scoped allow', '@scope/contract/private', { allow: ['@scope/contract/**'] }, 0],
    ['scoped forbid', '@scope/contract/private', { forbid: ['@scope/*/private'] }, 1],
    ['leading slash allow', 'contract-pkg/lib/private', { allow: ['/contract-pkg/lib/**'] }, 0],
    ['leading slash forbid', 'contract-pkg/lib/private', { forbid: ['/contract-pkg/lib/**'] }, 1],
    ['resolved allow', 'contract-pkg/lib/private', { allow: [`${fixture}/node_modules/contract-pkg/lib/**`] }, 0],
    ['resolved forbid', 'contract-pkg/lib/private', { forbid: [`${fixture}/node_modules/contract-pkg/lib/**`] }, 1],
    ['globstar allow', 'contract-pkg/lib/nested/deep', { allow: ['contract-pkg/**/deep'] }, 0],
    ['globstar forbid', 'contract-pkg/lib/nested/deep', { forbid: ['**/deep'] }, 1],
    ['negation allow', 'contract-pkg/lib/private', { allow: ['!contract-pkg/public/**'] }, 0],
    ['negation forbid', 'contract-pkg/lib/private', { forbid: ['!contract-pkg/public/**'] }, 1],
    ['double negation', 'contract-pkg/lib/private', { allow: ['!!contract-pkg/lib/**'] }, 0],
    ['extglob allow', 'contract-pkg/lib/public', { allow: ['contract-pkg/lib/@(public|safe)'] }, 0],
    ['extglob forbid', 'contract-pkg/lib/private', { forbid: ['contract-pkg/lib/!(public|safe)'] }, 1],
    ['extglob miss', 'contract-pkg/lib/public', { forbid: ['contract-pkg/lib/!(public|safe)'] }, 0],
    ['dot explicit', 'contract-pkg/lib/.hidden', { allow: ['contract-pkg/lib/.hidden'] }, 0],
    ['dot glob excluded', 'contract-pkg/lib/.hidden', { allow: ['contract-pkg/lib/*'] }, 1],
    ['dot forbid excluded', 'contract-pkg/lib/.hidden', { forbid: ['contract-pkg/**'] }, 0],
    ['direct dot allow legacy behavior', 'contract-pkg/.hidden', { allow: ['contract-pkg/**'] }, 0],
    ['direct dot forbid legacy behavior', 'contract-pkg/.hidden', { forbid: ['contract-pkg/**'] }, 1],
    ['package root globstar legacy behavior', 'contract-pkg', { forbid: ['contract-pkg/**'] }, 1],
    ['multiple globstar legacy behavior', 'contract-pkg/lib/private/nested', { forbid: ['contract-pkg/**/private/**'] }, 0],
    ['malformed bracket is literal', 'contract-pkg/lib/[oops', { allow: ['contract-pkg/lib/[oops'] }, 0],
    ['empty pattern allow', 'contract-pkg/lib/private', { allow: [''] }, 1],
    ['empty pattern forbid', 'contract-pkg/lib/private', { forbid: [''] }, 0],
    ['empty pattern index', '.', { forbid: [''] }, 0],
    ['empty pattern index slash', './', { forbid: [''] }, 0],
    ['empty pattern parent', '../', { forbid: [''] }, 0],
    ['comment pattern', 'contract-pkg/lib/private', { forbid: ['#contract-pkg/**'] }, 0],
    ['unresolved allow remains nonviolating', 'missing-contract/lib/file', { allow: [] }, 0],
  ]
  for (const format of ['ESM', 'CJS']) {
    const plugin = format === 'ESM'
      ? (await import(pathToFileURL(join(importXRoot, 'lib/index.js')))).default
      : require(importXEntry)
    const linter = new Linter({ cwd: fixture })
    function lint(source, options, settings = {}, rule = 'no-internal-modules') {
      return linter.verify(`import value from ${JSON.stringify(source)};`, {
        files: ['**/*.js'], plugins: { 'import-x': plugin }, settings,
        rules: { [`import-x/${rule}`]: options === undefined ? 'error' : ['error', options] },
      }, { filename: importer })
    }
    for (const [name, source, options, count] of ruleCases) {
      await test(`import-x ${format}: ${name}`, () => {
        const messages = lint(source, options)
        assert.equal(messages.length, count, JSON.stringify(messages))
        assert.ok(messages.every(message => message.ruleId === 'import-x/no-internal-modules' && message.messageId === 'noAllowed'))
      })
    }
    for (const mode of ['allow', 'forbid']) {
      await test(`import-x ${format}: Windows resolved ${mode}`, () => {
        const messages = lint('contract-pkg/lib/private', { [mode]: ['C:/contracts/contract-pkg/lib/**'] }, {
          'import-x/resolver': { [windowsResolver]: {} },
        })
        assert.equal(messages.length, mode === 'allow' ? 0 : 1, JSON.stringify(messages))
      })
      await test(`import-x ${format}: Windows import separator ${mode}`, () => {
        const messages = lint('contract-pkg\\lib\\private', { [mode]: ['contract-pkg/lib/**'] }, {
          'import-x/resolver': { [windowsResolver]: {} },
        })
        assert.equal(messages.length, mode === 'allow' ? 0 : 1, JSON.stringify(messages))
      })
    }
    await test(`import-x ${format}: existing no-restricted-paths matcher`, () => {
      const messages = lint('contract-pkg/lib/private', {
        zones: [{ target: './src/**', from: './node_modules/contract-pkg/lib/**' }],
        basePath: fixture,
      }, {}, 'no-restricted-paths')
      assert.equal(messages.length, 1, JSON.stringify(messages))
      assert.equal(messages[0].ruleId, 'import-x/no-restricted-paths')
    })
    await test(`import-x ${format}: invalid rule configuration is still rejected`, () => {
      assert.throws(() => lint('contract-pkg/lib/private', { allow: [null] }), /should be string/)
      assert.throws(() => lint('contract-pkg/lib/private', { allow: [], forbid: [] }), /should NOT have additional properties/)
    })
  }

  for (const [filename, expected] of [['src/main.js', 1], ['src/.hidden.js', 1], ['src/nested/main.js', 1], ['src/skip/main.js', 0]]) {
    await test(`ESLint config-array: file and ignore matching ${filename}`, () => {
      const messages = new Linter({ cwd: fixture }).verify('debugger;', [{
        files: [['**/*.js', '!**/skip/**']], rules: { 'no-debugger': 'error' },
      }], { filename: join(fixture, filename) })
      assert.equal(messages.filter(message => message.ruleId === 'no-debugger').length, expected)
    })
  }

  // The exact helper runs in each entrypoint's own realm; no renderer internals
  // are replaced or exposed to make these public-API security checks pass.
  function renderProbe(katex, scenario) {
    const attack = '\\href{javascript:alert(1)}{x}'
    try {
      if (scenario === 'options prototype') return katex.renderToString(attack, Object.create({ trust: true }))
      if (scenario === 'own trust false') return katex.renderToString(attack, Object.assign(Object.create({ trust: true }), { trust: false }))
      if (scenario === 'own trust true') return katex.renderToString(attack, { trust: true })
      if (scenario === 'inherited resource limit') return katex.renderToString('\\def\\foo{x}\\foo', Object.create({ maxExpand: 0 }))
      if (scenario === 'global trust') Object.prototype.trust = true
      if (scenario === 'default metadata') Object.prototype.default = true
      if (scenario === 'processor metadata') Object.prototype.processor = value => value === false ? true : value
      if (scenario === 'builtin namespace') {
        Object.prototype['\\pollutedMacro'] = 'p'
        return katex.renderToString('\\pollutedMacro')
      }
      if (scenario === 'namespace restoration') {
        const macros = Object.create({ '\\pollutedMacro': 'p' })
        katex.renderToString('{\\def\\pollutedMacro{x}}', { macros })
        return Object.prototype.hasOwnProperty.call(macros, '\\pollutedMacro')
      }
      return katex.renderToString(attack, scenario === 'processor metadata' ? { trust: false } : {})
    }
    finally {
      delete Object.prototype.trust
      delete Object.prototype.default
      delete Object.prototype.processor
      delete Object.prototype['\\pollutedMacro']
    }
  }
  const browserContext = vm.createContext({ console })
  vm.runInContext(readFileSync(katexEntry, 'utf8'), browserContext)
  const browserImportContext = vm.createContext({ console })
  const browserEntry = put('src/browser-katex.js', 'export { renderToString } from "@contract/katex";')
  const browserBundle = await rollup({
    input: browserEntry,
    plugins: [{
      name: 'contract-mermaid-import',
      resolveId(source) {
        if (source === '@contract/katex') return this.resolve('katex', require.resolve('mermaid'))
      },
    }, require(resolverEntry).nodeResolve({ browser: true })],
  })
  try {
    await test('Browser bundler: Mermaid selects patched KaTeX ESM export', () => {
      assert.ok(require.resolve('mermaid').endsWith('/dist/mermaid.core.mjs'))
      assert.ok(browserBundle.watchFiles.includes(join(katexRoot, 'dist/katex.mjs')))
      assert.ok(!browserBundle.watchFiles.some(file => file.endsWith('/katex.min.js')))
    })
    const { output } = await browserBundle.generate({ format: 'iife', name: 'KaTeXContract' })
    vm.runInContext(output[0].code, browserImportContext)
    browserImportContext.katex = browserImportContext.KaTeXContract
  }
  finally { await browserBundle.close() }
  const katexModules = {
    ESM: (await import(pathToFileURL(join(katexRoot, 'dist/katex.mjs')))).default,
    CJS: require(katexEntry),
    'browser UMD': browserContext.katex,
    'browser import': browserImportContext.katex,
  }
  for (const [format, katex] of Object.entries(katexModules)) {
    const context = format === 'browser UMD' ? browserContext : format === 'browser import' ? browserImportContext : undefined
    const probe = scenario => context
      ? vm.runInContext(`(${renderProbe.toString()})(katex, ${JSON.stringify(scenario)})`, context)
      : renderProbe(katex, scenario)
    for (const scenario of ['options prototype', 'global trust', 'default metadata', 'processor metadata', 'own trust false']) {
      await test(`KaTeX ${format}: ${scenario} cannot authorize unsafe href`, () => {
        assert.ok(!probe(scenario).includes('<a href='))
      })
    }
    await test(`KaTeX ${format}: explicit own trust remains supported`, () => {
      assert.ok(probe('own trust true').includes('<a href='))
    })
    await test(`KaTeX ${format}: inherited resource limit cannot alter defaults`, () => {
      assert.ok(probe('inherited resource limit').includes('katex'))
    })
    await test(`KaTeX ${format}: inherited builtin macro cannot expand`, () => {
      // Global pollution also reaches KaTeX's function table. After the macro
      // lookup rejects it, the parser rejects that value as a function handler.
      assert.throws(() => probe('builtin namespace'), /No function handler for \\pollutedMacro/)
    })
    await test(`KaTeX ${format}: group restoration cannot create own inherited macro`, () => {
      assert.equal(probe('namespace restoration'), false)
    })
    await test(`KaTeX ${format}: byte-identical benign renderToString`, () => {
      const outputs = benignCases.map(([tex, options]) => context
        ? vm.runInContext(`katex.renderToString(${JSON.stringify(tex)}, ${JSON.stringify(options)})`, context)
        : katex.renderToString(tex, structuredClone(options)))
      assert.deepEqual(outputs.map(hash), benignHashes)
    })
  }
  await test('KaTeX: CSS, fonts and assets remain byte-identical', () => {
    assert.equal(assetDigest(katexRoot), assetHash)
  })
}
finally { rmSync(fixture, { recursive: true, force: true }) }
