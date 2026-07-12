import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import schema from './schema.sql?raw'
import { seedDatabase } from './seed'

let singleton: Database.Database | undefined

export function openDatabase(filename = path.resolve('data/powerprompt.sqlite')) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true })
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(schema)
  seedDatabase(db)
  return db
}

export function getDatabase() {
  singleton ??= openDatabase()
  return singleton
}
