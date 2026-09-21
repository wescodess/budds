import { describe, expect, test } from 'vitest'
import {
  ADAPTIVE_LEARN_ACCOUNT_DELETE_ORDER,
  ADAPTIVE_LEARN_EXPORT_COLLECTIONS,
  ADAPTIVE_LEARN_STORAGE_MANIFEST,
} from './adaptive-learn-storage-manifest'

describe('Adaptive Learn storage manifest', () => {
  test('registers activity children before thread parents with bounded owner-scoped retention', () => {
    expect(ADAPTIVE_LEARN_STORAGE_MANIFEST).toEqual([
      {
        table: 'learningThreadActivities',
        ownerIndex: 'by_userId',
        parentIndex: 'by_userId_and_threadId_and_boundaryOrdinal',
        export: 'redacted_bounded',
        accountDeletion: 'delete',
      },
      {
        table: 'learningThreads',
        ownerIndex: 'by_userId',
        parentIndex: 'by_userId_and_updatedAt',
        export: 'bounded',
        accountDeletion: 'delete',
      },
    ])
    expect(ADAPTIVE_LEARN_ACCOUNT_DELETE_ORDER).toEqual(['learningThreadActivities', 'learningThreads'])
    expect(ADAPTIVE_LEARN_EXPORT_COLLECTIONS).toEqual(['learningThreads', 'learningThreadActivities'])
  })
})
