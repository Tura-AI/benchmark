import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate, seed } from './schema'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const dbPath = process.env.POWERPROMPT_DB ?? join(root, 'data', 'powerprompt.sqlite3')

let instance: Database.Database | undefined

export function getDb() {
  if (!instance) {
    mkdirSync(dirname(dbPath), { recursive: true })
    instance = new Database(dbPath)
    migrate(instance)
    seed(instance)
  }
  return instance
}

export function closeDb() {
  instance?.close()
  instance = undefined
}
