import ts from 'typescript'
import type { Plugin } from 'vite'

const runtime = 'globalThis.__buddsTimeoutIsolation'
const mutators = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear'])

export function timeoutIsolationPlugin(): Plugin {
  return {
    name: 'test-timeout-isolation',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0]!
      if (!/\/(?:convex\/.*\.test\.ts|tests\/(?:component\/.*\.test\.ts|fixtures\/.*\.ts))$/.test(path)) return
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const edits: Array<{ position: number, text: string, order: number }> = []
      const shared = new Set<string>(['process', 'globalThis', 'window', 'sessionStorage', 'localStorage'])
      const add = (position: number, text: string, opening = false) => edits.push({ position, text, order: opening ? -edits.length : edits.length })
      const wrap = (node: ts.Node, prefix: string, suffix = ')') => { add(node.getStart(file), prefix, true); add(node.end, suffix) }
      const declare = (name: ts.BindingName) => {
        if (ts.isIdentifier(name)) shared.add(name.text)
        else for (const part of name.elements) if (ts.isBindingElement(part)) declare(part.name)
      }
      const collect = (node: ts.Node, inFunction = false) => {
        if (ts.isImportDeclaration(node) && node.importClause) {
          if (node.importClause.name) shared.add(node.importClause.name.text)
          const names = node.importClause.namedBindings
          if (names && ts.isNamedImports(names)) for (const name of names.elements) shared.add(name.name.text)
          else if (names) shared.add(names.name.text)
        }
        if (ts.isVariableDeclaration(node) && !inFunction) declare(node.name)
        const suite = ts.isFunctionLike(node) && ts.isCallExpression(node.parent) && /^(describe|suite)(\.|$)/.test(node.parent.expression.getText(file))
        ts.forEachChild(node, child => collect(child, inFunction || (ts.isFunctionLike(node) && !suite)))
      }
      collect(file)
      const visit = (node: ts.Node, inFunction = false) => {
        if ((ts.isExpressionStatement(node) || ts.isVariableStatement(node) || ts.isReturnStatement(node) || ts.isThrowStatement(node)) && !source.slice(node.getStart(file), node.end).trimEnd().endsWith(';')) add(node.end, ';')
        if (ts.isCallExpression(node) && /^vi\.(mock|doMock|hoisted)$/.test(node.expression.getText(file))) return
        if (ts.isFunctionLike(node) && 'body' in node && node.body && ts.isBlock(node.body) && !ts.isConstructorDeclaration(node) && !ts.isGetAccessorDeclaration(node)) add(node.body.getStart(file) + 1, ` if (!${runtime}.active()) return; `)
        if (inFunction && ts.isAwaitExpression(node)) wrap(node.expression, `${runtime}.wait(`)
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
          const parent = node.parent
          const registration = ts.isCallExpression(parent) && (/^(test|it|describe|suite|beforeEach|afterEach|beforeAll|afterAll|aroundEach|aroundAll|onTestFinished|onTestFailed)(\.|$)/.test(parent.expression.getText(file)) || /\.run$/.test(parent.expression.getText(file)))
          if (ts.isCallExpression(parent) && parent.expression.getText(file) === 'beforeEach') wrap(node, `${runtime}.before(`)
          else if (inFunction && !registration) wrap(node, `${runtime}.bind(`)
        }
        if (inFunction && ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
          const left = node.left
          if ((ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left))) {
            wrap(left.expression, `${runtime}.reference(`)
          } else if (ts.isIdentifier(left) && shared.has(left.text)) {
            wrap(node, `(${runtime}.active() ? (${runtime}.scalar(${JSON.stringify(`${path}:${left.text}`)}, (() => { const value = ${left.text}; return () => { ${left.text} = value } })()), `, ') : undefined)')
          }
        }
        if (inFunction && (ts.isDeleteExpression(node) || ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)))) {
          const operand = ts.isDeleteExpression(node) ? node.expression : node.operand
          if ((ts.isPropertyAccessExpression(operand) || ts.isElementAccessExpression(operand))) wrap(operand.expression, `${runtime}.reference(`)
          else if (ts.isIdentifier(operand) && shared.has(operand.text)) wrap(node, `(${runtime}.active() ? (${runtime}.scalar(${JSON.stringify(`${path}:${operand.text}`)}, (() => { const value = ${operand.text}; return () => { ${operand.text} = value } })()), `, ') : undefined)')
        }
        if (inFunction && ts.isCallExpression(node)) {
          const name = node.expression.getText(file)
          const callbackIndex = /^(setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame)$/.test(name)
            || /\.(then|catch|finally|mockImplementation|mockImplementationOnce)$/.test(name) ? 0
            : /\.(addEventListener|on|once)$/.test(name) ? 1 : -1
          const callback = node.arguments[callbackIndex]
          if (callback && (ts.isIdentifier(callback) || ts.isPropertyAccessExpression(callback))) wrap(callback, `${runtime}.bind(`)
        }
        if (inFunction && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const call = node.expression
          if (['Object.assign', 'Object.defineProperty', 'Object.defineProperties', 'Reflect.set', 'Reflect.deleteProperty', 'Reflect.defineProperty'].includes(call.getText(file))) wrap(call, `${runtime}.builtin(${JSON.stringify(call.getText(file))}, `)
          else if (mutators.has(call.name.text)) wrap(call.expression, `${runtime}.mutationTarget(`)
        }
        ts.forEachChild(node, child => visit(child, inFunction || ts.isFunctionLike(node)))
      }
      visit(file)
      edits.sort((a, b) => b.position - a.position || a.order - b.order)
      const parts: string[] = []
      let cursor = 0
      for (let index = edits.length - 1; index >= 0; index--) {
        const edit = edits[index]!
        parts.push(source.slice(cursor, edit.position), edit.text)
        cursor = edit.position
      }
      parts.push(source.slice(cursor))
      return { code: parts.join(''), map: null }
    },
  }
}
