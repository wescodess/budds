import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'
import inventory from '../../tests/fixtures/learn-v2-read-inventory.json'

test('each public Convex query has an explicit C4 read audit entry', () => {
  const root = fileURLToPath(new URL('../../convex/', import.meta.url))
  const queries: string[] = []
  for (const file of readdirSync(root).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'schema.ts')) {
    const source = ts.createSourceFile(file, readFileSync(`${root}/${file}`, 'utf8'), ts.ScriptTarget.Latest, true)
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer
        if (!initializer || !ts.isCallExpression(initializer)) continue
        const path = `${file.slice(0, -3)}.${declaration.name.getText(source)}`
        if (initializer.expression.getText(source) === 'query'
          || initializer.expression.getText(source) === 'mutation' && inventory.some(entry => entry.path === path && entry.functionType === 'mutation')) queries.push(path)
      }
    }
  }
  expect(queries.sort()).toEqual(inventory.map(entry => entry.path).sort())
  expect(inventory.every(entry => entry.handling.length > 0)).toBe(true)
  expect(inventory).toContainEqual({ path: 'learnV2Assistance.authorizePracticeAssistance', functionType: 'mutation', handling: 'post_seal_practice_authorization' })
  expect(inventory).toContainEqual({ path: 'learnV2PostSealTeaching.openPractice', functionType: 'mutation', handling: 'post_seal_practice_preparation' })
  expect(inventory).toContainEqual({ path: 'learnV2PostSealTeaching.publishFeedback', functionType: 'mutation', handling: 'post_seal_feedback_publication' })
})
